mod network;
mod site;
mod solver;
mod tui;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use network::Network;
use std::time::{SystemTime, UNIX_EPOCH};
use tui::Referee;

/// Solve Tubele by guessing and narrowing down, using the TfL network map.
#[derive(Parser)]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Play today's game at tubele.app by itself (the default).
    Auto {
        /// Opening guess; without one, pick it in the UI.
        #[arg(long)]
        start: Option<String>,
        /// Show the browser window instead of running it headless.
        #[arg(long)]
        show: bool,
    },
    /// Play alongside the browser yourself, typing in what the game says.
    Play,
    /// Watch the solver play against a hidden station (random if none given).
    Demo {
        station: Option<String>,
        /// Opening guess; without one, pick it in the UI.
        #[arg(long)]
        start: Option<String>,
    },
    /// Play every station as the answer and report how many guesses it takes.
    Bench,
    /// Rebuild data/network.json from the TfL Unified API.
    Fetch,
}

fn main() -> Result<()> {
    let command = Cli::parse().command.unwrap_or(Command::Auto {
        start: None,
        show: false,
    });
    match command {
        Command::Auto { start, show } => {
            let net = Network::embedded();
            let opener = start.map(|s| find(&net, &s)).transpose()?;
            tui::run(net, Referee::Live(site::Site::launch(show)), opener)
        }
        Command::Play => tui::run(Network::embedded(), Referee::Manual, None),
        Command::Demo { station, start } => {
            let net = Network::embedded();
            let opener = start.map(|s| find(&net, &s)).transpose()?;
            let answer = match station {
                Some(name) => find(&net, &name)?,
                None => {
                    let nanos = SystemTime::now().duration_since(UNIX_EPOCH)?.subsec_nanos();
                    nanos as usize % net.len()
                }
            };
            tui::run(net, Referee::Simulated(answer), opener)
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

fn find(net: &Network, name: &str) -> Result<usize> {
    net.find(name)
        .with_context(|| format!("no station called {name:?}"))
}

fn bench(net: &Network) {
    let opener = solver::analyse(net, &[], &[]).ranked[0].station;
    println!("opening guess: {}", net.stations[opener].name);
    let mut histogram = vec![0usize; 21];
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
