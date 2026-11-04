//! Plays the live game at tubele.app in a headless browser: types guesses into
//! the page and reads back the feedback row it renders, exactly as a player
//! would. Nothing from the game's code or data is used.

use crate::network::{LINES, Network, line_name, normalise};
use crate::solver::{Feedback, ZoneMatch};
use anyhow::{Context, Result, anyhow, bail};
use headless_chrome::protocol::cdp::Network as Cdp;
use headless_chrome::{Browser, LaunchOptions, Tab};
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::thread;
use std::time::{Duration, Instant};

const URL: &str = "https://tubele.app/";

#[derive(Deserialize, Debug)]
pub struct Row {
    pub name: String,
    pub correct: bool,
    pub stops: Option<u8>,
    pub zone: Option<String>,
    pub lines: Vec<Pill>,
}

#[derive(Deserialize, Debug)]
pub struct Pill {
    pub name: String,
    pub shared: bool,
}

impl Row {
    /// Turn the row the page rendered into feedback.
    pub fn feedback(&self, net: &Network, guess: usize) -> Result<Feedback> {
        let station = &net.stations[guess];
        if normalise(&self.name) != normalise(&station.name) {
            bail!(
                "the page shows {:?} for a guess of {:?}",
                self.name,
                station.name
            );
        }
        if self.correct {
            return Ok(Feedback::compute(net, guess, guess));
        }
        let stops = self.stops.context("feedback row has no stop count")?;
        let zone = match self.zone.as_deref() {
            Some("exact") => ZoneMatch::Exact,
            Some("near") => ZoneMatch::Near,
            Some("none") => ZoneMatch::None,
            other => bail!("unrecognised zone match {other:?}"),
        };
        let mut shared = 0;
        for pill in &self.lines {
            let line = (0..LINES.len())
                .find(|&l| normalise(line_name(l)) == normalise(&pill.name))
                .with_context(|| format!("unknown line {:?}", pill.name))?;
            if pill.shared {
                shared |= 1 << line;
            }
        }
        Ok(Feedback {
            stops,
            zone,
            shared,
        })
    }
}

pub enum Event {
    Ready { puzzle: String },
    Row(Result<Row>),
    Failed(String),
}

/// Handle to the browser thread. Send a station name; a `Row` comes back.
pub struct Site {
    tx: Sender<Command>,
    pub rx: Receiver<Event>,
}

enum Command {
    Guess(String),
    NextRound,
}

impl Site {
    pub fn launch(show: bool) -> Self {
        let (tx, worker_rx) = channel::<Command>();
        let (worker_tx, rx) = channel();
        thread::spawn(move || {
            let session = match Session::open(show) {
                Ok(s) => s,
                Err(e) => {
                    let _ = worker_tx.send(Event::Failed(format!("{e:#}")));
                    return;
                }
            };
            let _ = worker_tx.send(Event::Ready {
                puzzle: session.puzzle(),
            });
            for command in worker_rx {
                let event = match command {
                    Command::Guess(name) => Event::Row(session.guess(&name)),
                    Command::NextRound => match session.next_round() {
                        Ok(()) => Event::Ready {
                            puzzle: session.puzzle(),
                        },
                        Err(e) => Event::Failed(format!("{e:#}")),
                    },
                };
                if worker_tx.send(event).is_err() {
                    break;
                }
            }
        });
        Self { tx, rx }
    }

    pub fn guess(&self, name: &str) {
        let _ = self.tx.send(Command::Guess(name.to_string()));
    }

    /// Start a practice round. The game only offers one once the current
    /// board is finished.
    pub fn next_round(&self) {
        let _ = self.tx.send(Command::NextRound);
    }
}

struct Session {
    _browser: Browser,
    tab: Arc<Tab>,
}

fn browser_path() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("TUBELE_BROWSER") {
        return Some(p.into());
    }
    if let Ok(p) = headless_chrome::browser::default_executable() {
        return Some(p);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    let fixed = [
        PathBuf::from("/Applications/Helium.app/Contents/MacOS/Helium"),
        PathBuf::from("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
        PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    ];
    if let Some(p) = fixed.into_iter().find(|p| p.exists()) {
        return Some(p);
    }
    // A browser Playwright has already downloaded.
    let cache = home.join("Library/Caches/ms-playwright");
    let mut dirs: Vec<_> = std::fs::read_dir(&cache)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .collect();
    dirs.sort();
    dirs.into_iter()
        .rev()
        .filter(|d| {
            d.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("chromium-"))
        })
        .find_map(|d| {
            ["chrome-mac-arm64", "chrome-mac"]
                .iter()
                .map(|sub| d.join(sub).join("Chromium.app/Contents/MacOS/Chromium"))
                .find(|p| p.exists())
        })
}

impl Session {
    fn open(show: bool) -> Result<Self> {
        let path =
            browser_path().context("no Chromium-based browser found; set TUBELE_BROWSER to one")?;
        let browser = Browser::new(
            LaunchOptions::default_builder()
                .path(Some(path))
                .headless(!show)
                .window_size(Some((1100, 1000)))
                .idle_browser_timeout(Duration::from_secs(3600))
                .build()
                .map_err(|e| anyhow!(e))?,
        )?;
        let tab = browser.new_tab()?;
        tab.set_default_timeout(Duration::from_secs(15));
        // Keep the solver's games out of the game's analytics.
        tab.call_method(Cdp::Enable {
            max_total_buffer_size: None,
            max_resource_buffer_size: None,
            max_post_data_size: None,
            report_direct_socket_traffic: None,
            enable_durable_messages: None,
        })?;
        tab.call_method(Cdp::SetBlockedURLs {
            urls: vec!["*/event*".into()],
        })?;
        tab.navigate_to(URL)?.wait_until_navigated()?;
        // Mark the how-to-play card as seen so it does not cover the board.
        tab.evaluate("localStorage.setItem('tubele.seen', '1')", false)?;
        tab.reload(true, None)?.wait_until_navigated()?;
        tab.wait_for_element_with_custom_timeout(".entry-input", Duration::from_secs(20))?;
        Ok(Self {
            _browser: browser,
            tab,
        })
    }

    fn eval(&self, js: &str) -> Result<serde_json::Value> {
        Ok(self
            .tab
            .evaluate(js, false)?
            .value
            .unwrap_or(serde_json::Value::Null))
    }

    fn rows(&self) -> Result<usize> {
        Ok(self
            .eval("document.querySelectorAll('li.row').length")?
            .as_u64()
            .unwrap_or(0) as usize)
    }

    fn puzzle(&self) -> String {
        self.eval("document.querySelector('.strap')?.textContent ?? ''")
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default()
    }

    fn next_round(&self) -> Result<()> {
        let click = r#"(() => {
            const b = [...document.querySelectorAll('button')]
                .find(b => /^(Practice round|Another round)$/.test(b.textContent.trim()));
            if (!b) return false;
            b.click();
            return true;
        })()"#;
        if self.eval(click)? != serde_json::Value::Bool(true) {
            bail!("the page offers no practice round yet");
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let fresh = self.eval(
                "document.querySelectorAll('li.row').length === 0 && !!document.querySelector('.entry-input')",
            )?;
            if fresh == serde_json::Value::Bool(true) {
                break;
            }
            if Instant::now() > deadline {
                bail!("the practice board did not appear");
            }
            thread::sleep(Duration::from_millis(100));
        }
        // Close the result card if it is still open over the board.
        self.tab.press_key("Escape")?;
        Ok(())
    }

    fn guess(&self, name: &str) -> Result<Row> {
        let before = self.rows()?;
        self.tab.wait_for_element(".entry-input")?;
        // Focused from script: a CDP click waits for layout to settle, which
        // can stall after the board is swapped for a practice round.
        self.eval("document.querySelector('.entry-input').focus()")?;
        self.tab.type_str(name)?;

        // Pick the suggestion whose text is exactly this station.
        let pick = format!(
            r#"(() => {{
                const want = {name:?}.toLowerCase();
                const opts = [...document.querySelectorAll('li.suggestion')];
                const hit = opts.find(o => o.firstElementChild?.textContent.trim().toLowerCase() === want);
                if (!hit) return opts.map(o => o.firstElementChild?.textContent.trim()).join(', ') || 'nothing';
                hit.dispatchEvent(new MouseEvent('mousedown', {{ bubbles: true, cancelable: true }}));
                return true;
            }})()"#
        );
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let result = self.eval(&pick)?;
            if result == serde_json::Value::Bool(true) {
                break;
            }
            if Instant::now() > deadline {
                self.eval(
                    "(() => { const i = document.querySelector('.entry-input'); i.select(); })()",
                )?;
                self.tab.press_key("Backspace")?;
                bail!("the game offered {result} for {name:?}");
            }
            thread::sleep(Duration::from_millis(100));
        }

        let deadline = Instant::now() + Duration::from_secs(5);
        while self.rows()? <= before {
            if Instant::now() > deadline {
                bail!("no feedback row appeared after guessing {name}");
            }
            thread::sleep(Duration::from_millis(100));
        }

        let read = r#"(() => {
            const rows = document.querySelectorAll('li.row');
            const r = rows[rows.length - 1];
            const zone = r.querySelector('.zone');
            return JSON.stringify({
                name: r.querySelector('.row-name')?.firstChild?.textContent.trim() ?? '',
                correct: r.classList.contains('row-correct'),
                stops: r.querySelector('.row-stops') ? Number(r.querySelector('.row-stops').textContent) : null,
                zone: zone ? [...zone.classList].find(c => c.startsWith('zone-'))?.slice(5) ?? null : null,
                lines: [...r.querySelectorAll('.pill')].map(p => ({
                    name: p.querySelector('.pill-name')?.textContent.trim() ?? '',
                    shared: p.classList.contains('pill-shared'),
                })),
            });
        })()"#;
        let json = self.eval(read)?;
        let text = json.as_str().context("feedback row did not read as text")?;
        serde_json::from_str(text).context("reading the feedback row")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Plays one real guess at tubele.app. Run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn reads_a_live_row() {
        let session = Session::open(false).unwrap();
        println!("puzzle: {}", session.puzzle());
        let row = session.guess("Stratford").unwrap();
        println!("{row:?}");
        assert_eq!(row.name, "Stratford");
        assert!(row.correct || row.stops.is_some());
        assert!(!row.lines.is_empty());
    }

    fn play_out(net: &Network, session: &Session) -> Vec<crate::solver::Observation> {
        println!("puzzle: {}", session.puzzle());
        let mut obs = Vec::new();
        for _ in 0..6 {
            let guess = crate::solver::analyse(&net, &obs, &[]).ranked[0].station;
            let feedback = session
                .guess(&net.stations[guess].name)
                .unwrap()
                .feedback(&net, guess)
                .unwrap();
            println!("{} -> {feedback:?}", net.stations[guess].name);
            obs.push(crate::solver::Observation { guess, feedback });
            if feedback.is_win() {
                break;
            }
        }
        obs
    }

    /// Plays the daily game, then a practice round, with the solver and nothing else.
    #[test]
    #[ignore]
    fn solves_daily_then_practice() {
        let net = Network::embedded();
        let session = Session::open(false).unwrap();
        assert!(play_out(&net, &session).last().unwrap().feedback.is_win());
        session.next_round().unwrap();
        assert_eq!(session.puzzle(), "Practice");
        assert!(play_out(&net, &session).last().unwrap().feedback.is_win());
    }
}
