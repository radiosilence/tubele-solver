use anyhow::{Context, Result, bail};
use ratatui::style::Color;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

/// Lines in the order the network is assembled. Order matters: when two stops
/// share a name, the first line to mention one decides which spelling and
/// position the merged station takes.
pub const LINES: &[(&str, &str, &str, u32)] = &[
    ("bakerloo", "Bakerloo", "Bak", 0xB36305),
    ("central", "Central", "Cen", 0xE32017),
    ("circle", "Circle", "Cir", 0xFFD300),
    ("district", "District", "Dis", 0x00782A),
    ("hammersmith-city", "H&C", "H&C", 0xF3A9BB),
    ("jubilee", "Jubilee", "Jub", 0xA0A5A9),
    ("metropolitan", "Metropolitan", "Met", 0x9B0056),
    ("northern", "Northern", "Nor", 0x000000),
    ("piccadilly", "Piccadilly", "Pic", 0x003688),
    ("victoria", "Victoria", "Vic", 0x0098D4),
    ("waterloo-city", "W&C", "W&C", 0x95CDBA),
    ("dlr", "DLR", "DLR", 0x00A4A7),
    ("elizabeth", "Elizabeth", "Eli", 0x6950A1),
    ("liberty", "Liberty", "Lib", 0x5D6061),
    ("lioness", "Lioness", "Lio", 0xFAA61A),
    ("mildmay", "Mildmay", "Mil", 0x0077AD),
    ("suffragette", "Suffragette", "Suf", 0x5BBD72),
    ("weaver", "Weaver", "Wea", 0x823A62),
    ("windrush", "Windrush", "Win", 0xEF3340),
];

pub fn line_colour(line: usize) -> Color {
    let rgb = LINES[line].3;
    // Northern is black on the map, which vanishes on a dark terminal.
    if rgb == 0 {
        return Color::Rgb(0x9a, 0x9a, 0x9a);
    }
    Color::Rgb((rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8)
}

pub fn line_name(line: usize) -> &'static str {
    LINES[line].1
}

pub fn line_code(line: usize) -> &'static str {
    LINES[line].2
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Station {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    /// Fare zones; empty when the station is outside them.
    pub zones: Vec<u8>,
    /// Bitmask over `LINES`.
    pub lines: u32,
}

#[derive(Serialize, Deserialize)]
pub struct Edge {
    pub a: u16,
    pub b: u16,
    pub lines: u32,
}

#[derive(Serialize, Deserialize)]
pub struct NetworkData {
    pub stations: Vec<Station>,
    pub edges: Vec<Edge>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    /// One neighbour on the whole network.
    Terminus,
    /// Served by more than one line.
    Interchange,
    Through,
}

pub struct Network {
    pub stations: Vec<Station>,
    pub edges: Vec<Edge>,
    /// Row-major n×n matrix of fewest-stops distances.
    dist: Vec<u8>,
    pub roles: Vec<Role>,
    /// Per station and line: stops to the nearest end of that line, riding
    /// only that line. `u8::MAX` where the line does not serve the station or
    /// has no ends.
    pub end_stops: Vec<[u8; 19]>,
}

impl Network {
    pub fn embedded() -> Self {
        let data: NetworkData = serde_json::from_str(include_str!("../data/network.json"))
            .expect("embedded network.json is valid");
        Self::new(data)
    }

    pub fn new(data: NetworkData) -> Self {
        let n = data.stations.len();
        let mut adj = vec![Vec::new(); n];
        for e in &data.edges {
            adj[e.a as usize].push(e.b as usize);
            adj[e.b as usize].push(e.a as usize);
        }
        let mut dist = vec![u8::MAX; n * n];
        let mut queue = VecDeque::new();
        for s in 0..n {
            let row = &mut dist[s * n..(s + 1) * n];
            row[s] = 0;
            queue.push_back(s);
            while let Some(u) = queue.pop_front() {
                for &v in &adj[u] {
                    if row[v] == u8::MAX {
                        row[v] = row[u] + 1;
                        queue.push_back(v);
                    }
                }
            }
        }
        let roles = (0..n)
            .map(|s| {
                if adj[s].len() == 1 {
                    Role::Terminus
                } else if data.stations[s].lines.count_ones() > 1 {
                    Role::Interchange
                } else {
                    Role::Through
                }
            })
            .collect();
        let end_stops = end_stops(n, &data.edges);
        Self {
            stations: data.stations,
            edges: data.edges,
            dist,
            roles,
            end_stops,
        }
    }

    pub fn len(&self) -> usize {
        self.stations.len()
    }

    pub fn dist(&self, a: usize, b: usize) -> u8 {
        self.dist[a * self.len() + b]
    }

    pub fn find(&self, name: &str) -> Option<usize> {
        let key = normalise(name);
        self.stations.iter().position(|s| normalise(&s.name) == key)
    }

    /// Stations matching a typed query, best first: prefix matches on the
    /// whole name, then on any word, then anywhere.
    pub fn search(&self, query: &str) -> Vec<usize> {
        let q = normalise(query);
        if q.is_empty() {
            return Vec::new();
        }
        let mut hits: Vec<(u8, usize)> = self
            .stations
            .iter()
            .enumerate()
            .filter_map(|(i, s)| {
                let name = normalise(&s.name);
                let rank = if name.starts_with(&q) {
                    0
                } else if name.split(' ').any(|w| w.starts_with(&q)) {
                    1
                } else if name.contains(&q) {
                    2
                } else {
                    return None;
                };
                Some((rank, i))
            })
            .collect();
        hits.sort_by(|a, b| {
            a.0.cmp(&b.0)
                .then_with(|| self.stations[a.1].name.cmp(&self.stations[b.1].name))
        });
        hits.into_iter().map(|(_, i)| i).collect()
    }
}

/// For each line, stations with at most one distinct neighbour along that
/// line are its ends; a multi-source BFS within the line gives every station
/// its distance to the nearest end.
fn end_stops(n: usize, edges: &[Edge]) -> Vec<[u8; 19]> {
    let mut out = vec![[u8::MAX; 19]; n];
    for (line, _) in LINES.iter().enumerate() {
        let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
        for e in edges.iter().filter(|e| e.lines & (1 << line) != 0) {
            adj[e.a as usize].push(e.b as usize);
            adj[e.b as usize].push(e.a as usize);
        }
        let mut queue: VecDeque<usize> = (0..n).filter(|&s| adj[s].len() == 1).collect();
        for &s in &queue {
            out[s][line] = 0;
        }
        while let Some(u) = queue.pop_front() {
            for &v in &adj[u] {
                if out[v][line] == u8::MAX {
                    out[v][line] = out[u][line] + 1;
                    queue.push_back(v);
                }
            }
        }
    }
    out
}

/// Transport mode of a line: 0 DLR, 1 Elizabeth, 2 Overground, 3 Underground,
/// which is also the alphabetical order of their ids.
pub fn line_mode(line: usize) -> usize {
    match line {
        11 => 0,
        12 => 1,
        13..=18 => 2,
        _ => 3,
    }
}

pub const MODE_NAMES: [&str; 4] = ["DLR", "Elizabeth line", "Overground", "Underground"];

/// Full line name, as the game writes it in a clue.
pub fn line_full_name(line: usize) -> &'static str {
    match LINES[line].0 {
        "hammersmith-city" => "Hammersmith & City",
        "waterloo-city" => "Waterloo & City",
        _ => LINES[line].1,
    }
}

pub fn normalise(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().replace('&', " and ").chars() {
        match c {
            '\'' | '’' | '`' | '.' => {}
            c if c.is_ascii_alphanumeric() => out.push(c),
            _ => {
                if !out.ends_with(' ') {
                    out.push(' ');
                }
            }
        }
    }
    out.trim().to_string()
}

// ─── Building from the TfL Unified API ───

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TflStopPoint {
    naptan_id: String,
    common_name: String,
    lat: f64,
    lon: f64,
    #[serde(default)]
    additional_properties: Vec<TflProperty>,
}

#[derive(Deserialize)]
struct TflProperty {
    key: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TflRoute {
    #[serde(default)]
    stop_point_sequences: Vec<TflSequence>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TflSequence {
    stop_point: Vec<TflSequenceStop>,
}

#[derive(Deserialize)]
struct TflSequenceStop {
    id: String,
}

/// Two stops with the same name further apart than this are different places.
const MERGE_RADIUS_M: f64 = 600.0;

/// TfL's commonName carries mode suffixes, operator prefixes and wayfinding
/// brackets. The two Edgware Roads and two Hammersmiths are separate stations
/// and keep a qualifier.
fn clean_name(raw: &str) -> String {
    let mut name = raw.trim().to_string();
    for suffix in [
        " Underground Station",
        " Rail Station",
        " DLR Station",
        " Station",
    ] {
        if let Some(stripped) = name.strip_suffix(suffix) {
            name = stripped.to_string();
            break;
        }
    }
    for suffix in [" (London)", " (Berks)"] {
        if let Some(stripped) = name.strip_suffix(suffix) {
            name = stripped.to_string();
        }
    }
    for (from, to) in [
        (" (for ExCel)", ""),
        (" (for Maritime Greenwich)", ""),
        ("Paddington (H&C Line)-Underground", "Paddington"),
        ("London Euston", "Euston"),
        ("London Liverpool Street", "Liverpool Street"),
        ("London Paddington", "Paddington"),
        ("New Cross ELL", "New Cross"),
        ("Shepherd's Bush (Central)", "Shepherd's Bush"),
        ("Edgware Road (Circle Line)", "Edgware Road (Circle)"),
        (
            "Hammersmith (Dist&Picc Line)",
            "Hammersmith (District & Piccadilly)",
        ),
        ("Hammersmith (H&C Line)", "Hammersmith (H&C & Circle)"),
    ] {
        name = name.replace(from, to);
    }
    name.trim().to_string()
}

fn parse_zones(raw: Option<&str>) -> Vec<u8> {
    let Some(raw) = raw else { return Vec::new() };
    let zones: BTreeSet<u8> = raw
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|s| s.parse().ok())
        .collect();
    zones.into_iter().collect()
}

fn metres_between(a: &Station, b: &Station) -> f64 {
    let r = 6_371_000.0;
    let (lat1, lat2) = (a.lat.to_radians(), b.lat.to_radians());
    let x = (b.lon - a.lon).to_radians() * ((lat1 + lat2) / 2.0).cos();
    let y = lat2 - lat1;
    r * x.hypot(y)
}

fn can_merge(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    !["Edgware Road (", "Hammersmith ("]
        .iter()
        .any(|p| a.starts_with(p) && b.starts_with(p))
}

fn get_json<T: serde::de::DeserializeOwned>(url: &str) -> Result<T> {
    ureq::get(url)
        .call()
        .with_context(|| format!("GET {url}"))?
        .body_mut()
        .with_config()
        .limit(50 * 1024 * 1024)
        .read_json()
        .with_context(|| format!("decoding {url}"))
}

pub fn fetch_from_tfl() -> Result<NetworkData> {
    let mut stations: Vec<Station> = Vec::new();
    let mut by_naptan: BTreeMap<String, usize> = BTreeMap::new();

    for (li, (id, ..)) in LINES.iter().enumerate() {
        eprintln!("  stop points: {id}");
        let stops: Vec<TflStopPoint> =
            get_json(&format!("https://api.tfl.gov.uk/Line/{id}/StopPoints"))?;
        if stops.is_empty() {
            bail!("line {id} returned no stop points");
        }
        for stop in stops {
            let zone = stop
                .additional_properties
                .iter()
                .find(|p| p.key == "Zone")
                .map(|p| p.value.as_str());
            let candidate = Station {
                name: clean_name(&stop.common_name),
                lat: (stop.lat * 1e5).round() / 1e5,
                lon: (stop.lon * 1e5).round() / 1e5,
                zones: parse_zones(zone),
                lines: 1 << li,
            };
            let key = normalise(&candidate.name);
            let hit = stations.iter().position(|s| {
                normalise(&s.name) == key
                    && can_merge(&s.name, &candidate.name)
                    && metres_between(s, &candidate) < MERGE_RADIUS_M
            });
            let index = match hit {
                Some(i) => {
                    let s = &mut stations[i];
                    s.lines |= candidate.lines;
                    if s.zones.is_empty() {
                        s.zones = candidate.zones;
                    }
                    if candidate.name.contains('\'') && !s.name.contains('\'') {
                        s.name = candidate.name;
                    }
                    i
                }
                None => {
                    stations.push(candidate);
                    stations.len() - 1
                }
            };
            by_naptan.insert(stop.naptan_id, index);
        }
    }

    let mut edges: BTreeMap<(u16, u16), u32> = BTreeMap::new();
    for (li, (id, ..)) in LINES.iter().enumerate() {
        eprintln!("  route: {id}");
        let route: TflRoute = get_json(&format!(
            "https://api.tfl.gov.uk/Line/{id}/Route/Sequence/all"
        ))?;
        for seq in route.stop_point_sequences {
            let ids: Vec<usize> = seq
                .stop_point
                .iter()
                .map(|s| {
                    by_naptan
                        .get(&s.id)
                        .copied()
                        .with_context(|| format!("{} on {id} has no stop point", s.id))
                })
                .collect::<Result<_>>()?;
            for w in ids.windows(2) {
                if w[0] != w[1] {
                    let (a, b) = (w[0].min(w[1]) as u16, w[0].max(w[1]) as u16);
                    *edges.entry((a, b)).or_default() |= 1 << li;
                }
            }
        }
    }

    // Sort stations by name for a stable file, remapping edge endpoints.
    let mut order: Vec<usize> = (0..stations.len()).collect();
    order.sort_by(|&a, &b| stations[a].name.cmp(&stations[b].name));
    let mut remap = vec![0u16; stations.len()];
    for (new, &old) in order.iter().enumerate() {
        remap[old] = new as u16;
    }
    let sorted: Vec<Station> = order.iter().map(|&i| stations[i].clone()).collect();
    let mut edges: Vec<Edge> = edges
        .into_iter()
        .map(|((a, b), lines)| {
            let (a, b) = (remap[a as usize], remap[b as usize]);
            Edge {
                a: a.min(b),
                b: a.max(b),
                lines,
            }
        })
        .collect();
    edges.sort_by_key(|e| (e.a, e.b));

    let data = NetworkData {
        stations: sorted,
        edges,
    };
    let net = Network::new(NetworkData {
        stations: data.stations.clone(),
        edges: data
            .edges
            .iter()
            .map(|e| Edge {
                a: e.a,
                b: e.b,
                lines: e.lines,
            })
            .collect(),
    });
    if net.dist.contains(&u8::MAX) {
        bail!("network is not connected");
    }
    let diameter = net.dist.iter().max().copied().unwrap_or(0);
    eprintln!(
        "  {} stations, {} edges, diameter {diameter} stops",
        data.stations.len(),
        data.edges.len()
    );
    Ok(data)
}
