
// Appended to tubele-rs's src/engine.rs by crosscheck-rs.sh; never committed
// there. Writes every station's clues and every pair's stops and zone match.
#[cfg(test)]
mod crosscheck_dump {
    use super::*;
    #[test]
    #[ignore]
    fn dump() {
        let net = Network::load().unwrap();
        let n = net.stations.len();
        let mut out = String::new();
        for (i, s) in net.stations.iter().enumerate() {
            let line = pick_stable(&s.lines, &s.name);
            let end = net.stops_to_end_by_line[i].get(line).copied().unwrap_or(net.stops_to_line_end[i]);
            let role = match net.roles[i] { Role::Interchange if s.out_of_station_interchange => "two-stations", Role::Interchange => "interchange", Role::Terminus => "terminus", Role::Through => "through" };
            let shown: Vec<String> = net.clues(s, 5).into_iter().map(|c| c.value).collect();
            out += &format!("C\t{}\t{}\t{}\t{}\t{}\t{}\t{}\n", s.name, shown[0], s.zones.as_ref().map_or("out".into(), |z| z.iter().map(u8::to_string).collect::<Vec<_>>().join("&")), role, line, end, s.name.chars().next().unwrap());
        }
        for g in 0..n {
            let d = net.stops_from(g);
            let row: Vec<String> = (0..n).map(|a| format!("{}{}", d[a], match compare_zones(net.stations[g].zones.as_deref(), net.stations[a].zones.as_deref()) { ZoneMatch::Exact => 'e', ZoneMatch::Near => 'n', ZoneMatch::None => 'x' })).collect();
            out += &format!("F\t{}\n", row.join(","));
        }
        std::fs::write(std::env::var("DUMP").unwrap(), out).unwrap();
    }
}
