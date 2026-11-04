mod network;
mod solver;
mod tui;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use network::Network;
use std::time::{SystemTime, UNIX_EPOCH};

/// Solve Tubele by guessing and narrowing down, using the TfL network map.
#[derive(Parser)]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Solve today's game: enter each guess and what the game said about it.
    Play,
    /// Watch the solver play against a hidden station (random if none given).
    Demo { station: Option<String> },
    /// Play every station as the answer and report how many guesses it takes.
    Bench,
    /// Rebuild data/network.json from the TfL Unified API.
    Fetch,
}

fn main() -> Result<()> {
    match Cli::parse().command.unwrap_or(Command::Play) {
        Command::Play => tui::run(Network::embedded(), None),
        Command::Demo { station } => {
            let net = Network::embedded();
            let answer = match station {
                Some(name) => net
                    .find(&name)
                    .with_context(|| format!("no station called {name:?}"))?,
                None => {
                    let nanos = SystemTime::now().duration_since(UNIX_EPOCH)?.subsec_nanos();
                    nanos as usize % net.len()
                }
            };
            tui::run(net, Some(answer))
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

fn bench(net: &Network) {
    let opener = solver::analyse(net, &[]).ranked[0].station;
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
