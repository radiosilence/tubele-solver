mod network;
mod site;
mod solver;
mod tui;

use anyhow::{Context, Result};
use clap::{CommandFactory, Parser, Subcommand};
use network::Network;
use std::time::{SystemTime, UNIX_EPOCH};
use tui::{Opener, Referee};

/// Solve Tubele by guessing and narrowing down, using the TfL network map.
#[derive(Parser)]
#[command(version)]
struct Cli {
    /// Print a shell completion script and exit.
    #[arg(long, value_name = "SHELL")]
    completions: Option<clap_complete::Shell>,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Play today's game at tubele.app by itself (the default).
    Auto {
        /// Opening guess: a station, `random`, or `zone:N` for a random station in zone N.
        /// Without one, pick it in the UI.
        #[arg(long)]
        start: Option<String>,
        /// After today's game, play this many practice rounds.
        #[arg(long, default_value_t = 0)]
        practice: usize,
        /// Show the browser window instead of running it headless.
        #[arg(long)]
        show: bool,
    },
    /// Play alongside the browser yourself, typing in what the game says.
    Play,
    /// Watch the solver play against a hidden station (random if none given).
    Demo {
        station: Option<String>,
        /// Opening guess: a station, `random`, or `zone:N`.
        #[arg(long)]
        start: Option<String>,
    },
    /// Play every station as the answer and report how many guesses it takes.
    Bench,
    /// Rank every station as an opening guess, overall and within each zone.
    Openers,
    /// Rebuild data/network.json from the TfL Unified API.
    Fetch,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    if let Some(shell) = cli.completions {
        clap_complete::generate(
            shell,
            &mut Cli::command(),
            "tubele-solver",
            &mut std::io::stdout(),
        );
        return Ok(());
    }
    let command = cli.command.unwrap_or(Command::Auto {
        start: None,
        practice: 0,
        show: false,
    });
    match command {
        Command::Auto {
            start,
            practice,
            show,
        } => {
            let net = Network::embedded();
            let opener = start.map(|s| opener(&net, &s)).transpose()?;
            tui::run(
                net,
                Referee::Live(site::Site::launch(show)),
                opener,
                practice,
            )
        }
        Command::Play => tui::run(Network::embedded(), Referee::Manual, None, 0),
        Command::Demo { station, start } => {
            let net = Network::embedded();
            let opener = start.map(|s| opener(&net, &s)).transpose()?;
            let answer = match station {
                Some(name) => find(&net, &name)?,
                None => {
                    let nanos = SystemTime::now().duration_since(UNIX_EPOCH)?.subsec_nanos();
                    nanos as usize % net.len()
                }
            };
            tui::run(net, Referee::Simulated(answer), opener, 0)
        }
        Command::Openers => {
            openers(&Network::embedded());
            Ok(())
        }
        Command::Bench => {
            bench(&Network::embedded());
            Ok(())
        }
        Command::Fetch => {
            let data = network::fetch_from_tfl()?;
            let path = concat!(env!("CARGO_MANIFEST_DIR"), "/data/network.json");
            std::fs::write(path, serde_json::to_string(&data)? + "\n")?;
            eprintln!("wrote {path}");
            Ok(())
        }
    }
}

fn opener(net: &Network, spec: &str) -> Result<Opener> {
    if spec.eq_ignore_ascii_case("random") {
        return Ok(Opener::Random(None));
    }
    if let Some(zone) = spec.strip_prefix("zone:") {
        let zone = zone
            .parse()
            .with_context(|| format!("not a zone: {zone:?}"))?;
        return Ok(Opener::Random(Some(zone)));
    }
    find(net, spec).map(Opener::Station)
}

fn find(net: &Network, name: &str) -> Result<usize> {
    net.find(name)
        .with_context(|| format!("no station called {name:?}"))
}

fn bench(net: &Network) {
    let opener = solver::analyse(net, &[], &[]).ranked[0].station;
    println!("opening guess: {}", net.stations[opener].name);
    let mut histogram = [0usize; 21];
    let mut worst = Vec::new();
    for answer in 0..net.len() {
        let game = solver::play(net, answer, Some(opener));
        histogram[game.len()] += 1;
        if game.len() > 6 {
            worst.push(net.stations[answer].name.clone());
        }
    }
    let total = net.len() as f64;
    let mean = histogram
        .iter()
        .enumerate()
        .map(|(k, &c)| k * c)
        .sum::<usize>() as f64
        / total;
    let max = *histogram.iter().max().unwrap_or(&1);
    for (k, &c) in histogram.iter().enumerate().filter(|&(_, &c)| c > 0) {
        let bar = "█".repeat((c * 50).div_ceil(max));
        println!("{k:>2} guesses │ {bar} {c}");
    }
    println!("mean {mean:.3} guesses over {} stations", net.len());
    if worst.is_empty() {
        println!("every station solved within six guesses");
    } else {
        println!("over six guesses: {}", worst.join(", "));
    }
}

struct OpenerScore {
    station: usize,
    mean: f64,
    worst: usize,
    /// Share of answers found within two and three guesses.
    within2: f64,
    within3: f64,
    /// Expected candidates left after the opener alone.
    left: f64,
    /// Guesses needed for each answer, indexed by station.
    lengths: Vec<usize>,
}

/// Every station as the opener against every station as the answer, with the
/// solver playing on from guess two. Answers are weighted equally: the solver
/// knows nothing about which stations the game prefers.
fn openers(net: &Network) {
    let n = net.len();
    let first = solver::rank(net, &(0..n).collect::<Vec<_>>(), &[]);
    let left = |s: usize| {
        first
            .iter()
            .find(|r| r.station == s)
            .map_or(f64::NAN, |r| r.expected_left)
    };
    let threads = std::thread::available_parallelism().map_or(4, |t| t.get());
    let chunk = n.div_ceil(threads);
    let mut scores: Vec<OpenerScore> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..n)
            .collect::<Vec<_>>()
            .chunks(chunk)
            .map(|openers| {
                let openers = openers.to_vec();
                scope.spawn(move || {
                    openers
                        .into_iter()
                        .map(|o| {
                            let lengths: Vec<usize> = (0..n)
                                .map(|a| solver::play(net, a, Some(o)).len())
                                .collect();
                            let share = |k: usize| {
                                lengths.iter().filter(|&&l| l <= k).count() as f64 / n as f64
                            };
                            OpenerScore {
                                station: o,
                                mean: lengths.iter().sum::<usize>() as f64 / n as f64,
                                worst: *lengths.iter().max().unwrap_or(&0),
                                within2: share(2),
                                within3: share(3),
                                left: left(o),
                                lengths,
                            }
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().unwrap())
            .collect()
    });
    scores.sort_by(|a, b| a.mean.total_cmp(&b.mean).then(a.worst.cmp(&b.worst)));

    let row = |s: &OpenerScore| {
        let st = &net.stations[s.station];
        let zones = if st.zones.is_empty() {
            "out".to_string()
        } else {
            st.zones
                .iter()
                .map(u8::to_string)
                .collect::<Vec<_>>()
                .join("/")
        };
        println!(
            "  {:<32} {:>5}  {:>6.3}  {:>5}  {:>5.1}%  {:>5.1}%  {:>6.2}",
            st.name,
            zones,
            s.mean,
            s.worst,
            s.within2 * 100.0,
            s.within3 * 100.0,
            s.left
        );
    };
    let header = || {
        println!(
            "  {:<32} {:>5}  {:>6}  {:>5}  {:>6}  {:>6}  {:>6}",
            "opener", "zone", "mean", "worst", "≤2", "≤3", "left"
        )
    };
    println!("best openers overall");
    header();
    scores.iter().take(15).for_each(row);
    println!("\nworst openers");
    header();
    scores.iter().rev().take(5).for_each(row);
    println!("\nbest opener in each zone");
    header();
    let mut zones: Vec<u8> = net.stations.iter().flat_map(|s| s.zones.clone()).collect();
    zones.sort();
    zones.dedup();
    for z in zones {
        if let Some(s) = scores
            .iter()
            .find(|s| net.stations[s.station].zones.contains(&z))
        {
            print!("Z{z}");
            row(s);
        }
    }
    if let Some(s) = scores
        .iter()
        .find(|s| net.stations[s.station].zones.is_empty())
    {
        print!("out");
        row(s);
    }
    let modes: [(&str, std::ops::RangeInclusive<usize>); 4] = [
        ("Tube", 0..=10),
        ("DLR", 11..=11),
        ("Elizabeth", 12..=12),
        ("Overground", 13..=18),
    ];
    let on = |s: usize, lines: &std::ops::RangeInclusive<usize>| {
        lines.clone().any(|l| net.stations[s].lines & (1 << l) != 0)
    };
    println!("\nbest opener on each mode");
    header();
    for (name, lines) in &modes {
        if let Some(s) = scores.iter().find(|s| on(s.station, lines)) {
            print!("{name}");
            row(s);
        }
    }
    println!("\nbest opener served only by each mode");
    header();
    for (name, lines) in &modes {
        let mask: u32 = lines.clone().map(|l| 1u32 << l).sum();
        if let Some(s) = scores
            .iter()
            .find(|s| net.stations[s.station].lines & !mask == 0)
        {
            print!("{name}");
            row(s);
        }
    }
    let best = &scores[0];
    println!(
        "\nhow hard each mode's stations are to find, opening with {}",
        net.stations[best.station].name
    );
    let difficulty = |label: &str, answers: Vec<usize>| {
        let k = answers.len() as f64;
        let lens: Vec<usize> = answers.iter().map(|&a| best.lengths[a]).collect();
        let mean = lens.iter().sum::<usize>() as f64 / k;
        let slow = lens.iter().filter(|&&l| l >= 4).count() as f64 / k;
        // Candidates left after the opener, averaged over answers: how much
        // searching is still to do once the first clue is in.
        let alive = answers
            .iter()
            .map(|&a| {
                let f = solver::Feedback::compute(net, best.station, a);
                (0..n)
                    .filter(|&c| solver::Feedback::compute(net, best.station, c) == f)
                    .count()
            })
            .sum::<usize>() as f64
            / k;
        println!(
            "  {label:<14} {:>4} stations  {mean:>6.3} avg  {:>5.1}% need 4+  {alive:>6.1} left after opener",
            answers.len(),
            slow * 100.0
        );
    };
    for (name, lines) in &modes {
        difficulty(name, (0..n).filter(|&s| on(s, lines)).collect());
    }
    println!("\n  by line");
    for l in 0..network::LINES.len() {
        difficulty(
            network::line_name(l),
            (0..n)
                .filter(|&s| net.stations[s].lines & (1 << l) != 0)
                .collect(),
        );
    }
    let mean_all = scores.iter().map(|s| s.mean).sum::<f64>() / n as f64;
    println!("\na random opener averages {mean_all:.3} guesses");
}
