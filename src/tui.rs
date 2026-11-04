use crate::network::{LINES, Network, line_code, line_colour, line_name};
use crate::solver::{self, Analysis, Feedback, Observation, ZoneMatch};
use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::{
    DefaultTerminal, Frame,
    layout::{Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    symbols::Marker,
    text::{Line, Span},
    widgets::{
        Block, BorderType, Padding, Paragraph, Wrap,
        canvas::{Canvas, Context, Line as MapLine, Points},
    },
};
use std::time::{Duration, Instant};

const MAX_GUESSES: usize = 6;
const BG: Color = Color::Rgb(0x14, 0x13, 0x0f);
const FAINT: Color = Color::Rgb(0x4a, 0x47, 0x40);
const MUTED: Color = Color::Rgb(0x8a, 0x86, 0x7c);
const TEXT: Color = Color::Rgb(0xe8, 0xe4, 0xda);
const ACCENT: Color = Color::Rgb(0xff, 0xd3, 0x00);
const SUGGEST: Color = Color::Rgb(0xff, 0x6a, 0xd5);

enum Stage {
    Pick {
        query: String,
        cursor: usize,
    },
    Feedback {
        guess: usize,
        stops: String,
        zone: ZoneMatch,
        shared: u32,
    },
    Done,
}

struct App {
    net: Network,
    /// Set in demo mode; the solver never looks at it, only the referee does.
    answer: Option<usize>,
    obs: Vec<Observation>,
    analysis: Analysis,
    stage: Stage,
    full_map: bool,
    autoplay: bool,
    last_step: Instant,
}

pub fn run(net: Network, answer: Option<usize>) -> Result<()> {
    let analysis = solver::analyse(&net, &[]);
    let mut app = App {
        net,
        answer,
        obs: Vec::new(),
        analysis,
        stage: Stage::Pick {
            query: String::new(),
            cursor: 0,
        },
        full_map: false,
        autoplay: false,
        last_step: Instant::now(),
    };
    let mut terminal = ratatui::init();
    let result = app.event_loop(&mut terminal);
    ratatui::restore();
    result
}

impl App {
    fn event_loop(&mut self, terminal: &mut DefaultTerminal) -> Result<()> {
        loop {
            terminal.draw(|f| self.draw(f))?;
            if event::poll(Duration::from_millis(100))? {
                if let Event::Key(key) = event::read()?
                    && key.kind == KeyEventKind::Press
                    && !self.on_key(key)
                {
                    return Ok(());
                }
            } else if self.autoplay && self.last_step.elapsed() > Duration::from_millis(1400) {
                self.demo_step();
            }
        }
    }

    fn suggestion(&self) -> Option<usize> {
        self.analysis.ranked.first().map(|s| s.station)
    }

    fn matches(&self, query: &str) -> Vec<usize> {
        let guessed: Vec<usize> = self.obs.iter().map(|o| o.guess).collect();
        self.net
            .search(query)
            .into_iter()
            .filter(|s| !guessed.contains(s))
            .take(8)
            .collect()
    }

    fn commit(&mut self, obs: Observation) {
        self.obs.push(obs);
        self.analysis = solver::analyse(&self.net, &self.obs);
        self.last_step = Instant::now();
        self.stage = if obs.feedback.is_win() || self.analysis.candidates.is_empty() {
            Stage::Done
        } else {
            Stage::Pick {
                query: String::new(),
                cursor: 0,
            }
        };
    }

    fn undo(&mut self) {
        self.obs.pop();
        self.analysis = solver::analyse(&self.net, &self.obs);
        self.stage = Stage::Pick {
            query: String::new(),
            cursor: 0,
        };
    }

    /// Guess `station`. In demo mode the referee scores it at once; otherwise
    /// the player reads the game's answer back in.
    fn guess(&mut self, station: usize) {
        match self.answer {
            Some(answer) => {
                let feedback = Feedback::compute(&self.net, station, answer);
                self.commit(Observation {
                    guess: station,
                    feedback,
                });
            }
            None => {
                self.stage = Stage::Feedback {
                    guess: station,
                    stops: String::new(),
                    zone: ZoneMatch::Exact,
                    shared: 0,
                }
            }
        }
    }

    fn demo_step(&mut self) {
        if matches!(self.stage, Stage::Pick { .. })
            && let Some(s) = self.suggestion()
        {
            self.guess(s);
        }
        if matches!(self.stage, Stage::Done) {
            self.autoplay = false;
        }
    }

    /// Returns false to quit.
    fn on_key(&mut self, key: KeyEvent) -> bool {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);
        match key.code {
            KeyCode::Char('c') if ctrl => return false,
            KeyCode::Char('z') if ctrl => {
                self.undo();
                return true;
            }
            KeyCode::Tab => {
                self.full_map = !self.full_map;
                return true;
            }
            _ => {}
        }
        match &mut self.stage {
            Stage::Done => match key.code {
                KeyCode::Char('q') | KeyCode::Esc | KeyCode::Enter => return false,
                KeyCode::Char('u') | KeyCode::Backspace => self.undo(),
                _ => {}
            },
            Stage::Pick { query, cursor } => match key.code {
                KeyCode::Esc if query.is_empty() => return false,
                KeyCode::Esc => {
                    query.clear();
                    *cursor = 0;
                }
                KeyCode::Char(' ') if self.answer.is_some() && query.is_empty() => self.demo_step(),
                KeyCode::Char('a') if self.answer.is_some() && query.is_empty() => {
                    self.autoplay = !self.autoplay;
                    self.last_step = Instant::now();
                }
                KeyCode::Char(c) => {
                    query.push(c);
                    *cursor = 0;
                }
                KeyCode::Backspace => {
                    query.pop();
                    *cursor = 0;
                }
                KeyCode::Down | KeyCode::Right => *cursor += 1,
                KeyCode::Up | KeyCode::Left => *cursor = cursor.saturating_sub(1),
                KeyCode::Enter => {
                    let (query, cursor) = (query.clone(), *cursor);
                    let pick = if query.is_empty() {
                        self.suggestion()
                    } else {
                        let m = self.matches(&query);
                        m.get(cursor.min(m.len().saturating_sub(1))).copied()
                    };
                    if let Some(s) = pick {
                        self.guess(s);
                    }
                }
                _ => {}
            },
            Stage::Feedback {
                guess,
                stops,
                zone,
                shared,
            } => match key.code {
                KeyCode::Esc => {
                    self.stage = Stage::Pick {
                        query: String::new(),
                        cursor: 0,
                    }
                }
                KeyCode::Char(c) if c.is_ascii_digit() && !ctrl && stops.len() < 2 => stops.push(c),
                KeyCode::Backspace => {
                    stops.pop();
                }
                KeyCode::Char('e') => *zone = ZoneMatch::Exact,
                KeyCode::Char('n') => *zone = ZoneMatch::Near,
                KeyCode::Char('x') => *zone = ZoneMatch::None,
                KeyCode::Char('z') => {
                    *zone = match zone {
                        ZoneMatch::Exact => ZoneMatch::Near,
                        ZoneMatch::Near => ZoneMatch::None,
                        ZoneMatch::None => ZoneMatch::Exact,
                    }
                }
                KeyCode::Char(c) if c.is_ascii_lowercase() => {
                    let lines = line_list(self.net.stations[*guess].lines);
                    if let Some(&l) = (0..lines.len())
                        .position(|i| line_key(i) == c)
                        .and_then(|k| lines.get(k))
                    {
                        *shared ^= 1 << l;
                    }
                }
                KeyCode::Enter if !stops.is_empty() => {
                    let stops: u8 = stops.parse().unwrap_or(0);
                    let feedback = if stops == 0 {
                        Feedback::compute(&self.net, *guess, *guess)
                    } else {
                        Feedback {
                            stops,
                            zone: *zone,
                            shared: *shared,
                        }
                    };
                    let guess = *guess;
                    self.commit(Observation { guess, feedback });
                }
                _ => {}
            },
        }
        true
    }

    // ─── Drawing ───

    fn draw(&self, f: &mut Frame) {
        f.render_widget(Block::new().style(Style::new().bg(BG).fg(TEXT)), f.area());
        let [header, body, footer] = Layout::vertical([
            Constraint::Length(1),
            Constraint::Min(10),
            Constraint::Length(6),
        ])
        .areas(f.area());
        let [map, side] =
            Layout::horizontal([Constraint::Percentage(58), Constraint::Percentage(42)])
                .areas(body);
        let [guesses, next, left] = Layout::vertical([
            Constraint::Length(9),
            Constraint::Length(9),
            Constraint::Min(4),
        ])
        .areas(side);

        self.draw_header(f, header);
        self.draw_map(f, map);
        self.draw_guesses(f, guesses);
        self.draw_next(f, next);
        self.draw_candidates(f, left);
        self.draw_input(f, footer);
    }

    fn panel(title: &str) -> Block<'_> {
        Block::bordered()
            .border_type(BorderType::Rounded)
            .border_style(Style::new().fg(FAINT))
            .title(Span::styled(
                format!(" {title} "),
                Style::new().fg(MUTED).bold(),
            ))
            .padding(Padding::horizontal(1))
    }

    fn draw_header(&self, f: &mut Frame, area: Rect) {
        let n = self.analysis.candidates.len();
        let mut spans = vec![
            Span::styled(
                " ● TUBELE ",
                Style::new().fg(BG).bg(Color::Rgb(0xdc, 0x24, 0x1f)).bold(),
            ),
            Span::styled(
                " SOLVER ",
                Style::new()
                    .fg(TEXT)
                    .bg(Color::Rgb(0x00, 0x19, 0xa8))
                    .bold(),
            ),
            Span::raw("  "),
            Span::styled(
                format!(
                    "guess {}/{MAX_GUESSES}",
                    if matches!(self.stage, Stage::Done) {
                        self.obs.len()
                    } else {
                        self.obs.len() + 1
                    }
                ),
                Style::new().fg(MUTED),
            ),
            Span::styled("  ·  ", Style::new().fg(FAINT)),
            Span::styled(format!("{n} possible"), Style::new().fg(ACCENT).bold()),
            Span::styled(
                format!(" ({:.1} bits to go)", (n.max(1) as f64).log2()),
                Style::new().fg(MUTED),
            ),
        ];
        if self.answer.is_some() {
            spans.push(Span::styled("  ·  demo", Style::new().fg(SUGGEST)));
            if self.autoplay {
                spans.push(Span::styled(" ▶ autoplay", Style::new().fg(SUGGEST)));
            }
        }
        if self.analysis.mismatch > 0 {
            spans.push(Span::styled(
                "  ⚠ nothing fits every clue exactly; showing the closest",
                Style::new().fg(Color::Rgb(0xff, 0x8c, 0x42)),
            ));
        }
        f.render_widget(Line::from(spans), area);
    }

    fn draw_map(&self, f: &mut Frame, area: Rect) {
        let net = &self.net;
        let alive: Vec<bool> = {
            let mut v = vec![false; net.len()];
            for &c in &self.analysis.candidates {
                v[c] = true;
            }
            v
        };
        let suggestion = match self.stage {
            Stage::Pick { .. } => self.suggestion(),
            _ => None,
        };
        let focus: Vec<usize> = if self.full_map {
            (0..net.len()).collect()
        } else {
            self.analysis
                .candidates
                .iter()
                .copied()
                .chain(suggestion)
                .collect()
        };
        let inner = Self::panel("").inner(area);
        let (x_bounds, y_bounds) = fit_bounds(net, &focus, inner);
        let title = if self.full_map {
            "map · whole network (tab to focus)"
        } else {
            "map · focused on what's left (tab for all)"
        };

        let canvas = Canvas::default()
            .block(Self::panel(title))
            .background_color(BG)
            .marker(Marker::Braille)
            .x_bounds(x_bounds)
            .y_bounds(y_bounds)
            .paint(move |ctx: &mut Context| {
                for e in &net.edges {
                    let (a, b) = (&net.stations[e.a as usize], &net.stations[e.b as usize]);
                    let colour = line_colour(e.lines.trailing_zeros() as usize);
                    let live = alive[e.a as usize] || alive[e.b as usize];
                    ctx.draw(&MapLine {
                        x1: a.lon,
                        y1: a.lat,
                        x2: b.lon,
                        y2: b.lat,
                        color: if live {
                            colour
                        } else {
                            blend(colour, BG, 0.78)
                        },
                    });
                }
                ctx.layer();
                let dead: Vec<(f64, f64)> = (0..net.len())
                    .filter(|&i| !alive[i])
                    .map(|i| (net.stations[i].lon, net.stations[i].lat))
                    .collect();
                ctx.draw(&Points {
                    coords: &dead,
                    color: FAINT,
                });
                let live: Vec<(f64, f64)> = self
                    .analysis
                    .candidates
                    .iter()
                    .map(|&i| (net.stations[i].lon, net.stations[i].lat))
                    .collect();
                ctx.draw(&Points {
                    coords: &live,
                    color: TEXT,
                });
                ctx.layer();

                if self.analysis.candidates.len() <= 14 {
                    for &c in &self.analysis.candidates {
                        let s = &net.stations[c];
                        ctx.print(
                            s.lon,
                            s.lat,
                            Span::styled(format!("·{}", s.name), Style::new().fg(TEXT)),
                        );
                    }
                }
                for o in &self.obs {
                    let s = &net.stations[o.guess];
                    let label = if o.feedback.is_win() {
                        format!("★ {}", s.name)
                    } else {
                        format!("● {} {}", s.name, o.feedback.stops)
                    };
                    ctx.print(
                        s.lon,
                        s.lat,
                        Span::styled(label, Style::new().fg(heat(o.feedback.stops)).bold()),
                    );
                }
                if let Some(g) = suggestion {
                    let s = &net.stations[g];
                    ctx.print(
                        s.lon,
                        s.lat,
                        Span::styled(format!("◆ {}?", s.name), Style::new().fg(SUGGEST).bold()),
                    );
                }
            });
        f.render_widget(canvas, area);
    }

    fn draw_guesses(&self, f: &mut Frame, area: Rect) {
        let mut lines: Vec<Line> = Vec::new();
        for (i, o) in self.obs.iter().enumerate() {
            let s = &self.net.stations[o.guess];
            let fb = o.feedback;
            let mut spans = vec![
                Span::styled(format!("{} ", i + 1), Style::new().fg(MUTED)),
                Span::styled(
                    format!("{:<20}", truncate(&s.name, 20)),
                    Style::new().fg(TEXT).bold(),
                ),
            ];
            if fb.is_win() {
                spans.push(Span::styled(
                    " ★ got it ",
                    Style::new().fg(BG).bg(Color::Rgb(0x5b, 0xbd, 0x72)).bold(),
                ));
            } else {
                spans.push(Span::styled(
                    format!("{:>2} stops ", fb.stops),
                    Style::new().fg(heat(fb.stops)).bold(),
                ));
                spans.push(zone_chip(&s.zones, fb.zone));
                spans.push(Span::raw(" "));
                for l in line_list(s.lines) {
                    spans.push(line_chip(l, fb.shared & (1 << l) != 0, true));
                }
            }
            lines.push(Line::from(spans));
        }
        for i in self.obs.len()..MAX_GUESSES {
            lines.push(Line::styled(format!("{} ·", i + 1), Style::new().fg(FAINT)));
        }
        f.render_widget(Paragraph::new(lines).block(Self::panel("guesses")), area);
    }

    fn draw_next(&self, f: &mut Frame, area: Rect) {
        let mut lines = Vec::new();
        if matches!(self.stage, Stage::Done) {
            let line = match self.obs.last() {
                Some(o) if o.feedback.is_win() => Line::from(vec![
                    Span::styled("Solved in ", Style::new().fg(TEXT)),
                    Span::styled(
                        format!("{}", self.obs.len()),
                        Style::new().fg(ACCENT).bold(),
                    ),
                    Span::styled(
                        format!(": {}", self.net.stations[o.guess].name),
                        Style::new().fg(TEXT),
                    ),
                ]),
                _ => Line::styled(
                    "No station fits. Ctrl-Z to undo a guess.",
                    Style::new().fg(MUTED),
                ),
            };
            lines.push(line);
        } else {
            lines.push(Line::from(vec![
                Span::styled(format!("{:<22}", "station"), Style::new().fg(FAINT)),
                Span::styled("  left   bits  worst", Style::new().fg(FAINT)),
            ]));
            for (i, s) in self.analysis.ranked.iter().take(6).enumerate() {
                let name = &self.net.stations[s.station].name;
                let colour = if i == 0 { SUGGEST } else { TEXT };
                lines.push(Line::from(vec![
                    Span::styled(if i == 0 { "◆ " } else { "  " }, Style::new().fg(SUGGEST)),
                    Span::styled(
                        format!("{:<20}", truncate(name, 20)),
                        Style::new().fg(colour).add_modifier(if i == 0 {
                            Modifier::BOLD
                        } else {
                            Modifier::empty()
                        }),
                    ),
                    Span::styled(
                        format!(
                            "{:>6.2} {:>6.2} {:>6}",
                            s.expected_left, s.entropy, s.worst_case
                        ),
                        Style::new().fg(MUTED),
                    ),
                    Span::styled(
                        if s.could_win { "  ✓" } else { "" },
                        Style::new().fg(Color::Rgb(0x5b, 0xbd, 0x72)),
                    ),
                ]));
            }
        }
        f.render_widget(
            Paragraph::new(lines).block(Self::panel("best next guess")),
            area,
        );
    }

    fn draw_candidates(&self, f: &mut Frame, area: Rect) {
        let c = &self.analysis.candidates;
        let p = 100.0 / c.len().max(1) as f64;
        let title = format!("still possible · {p:.1}% each");
        let body: Vec<Line> = if c.len() <= 60 {
            let mut spans = Vec::new();
            for &i in c {
                spans.push(Span::styled(
                    self.net.stations[i].name.clone(),
                    Style::new().fg(TEXT),
                ));
                spans.push(Span::styled("  ·  ", Style::new().fg(FAINT)));
            }
            spans.pop();
            vec![Line::from(spans)]
        } else {
            let mut counts = [0usize; 11];
            for &i in c {
                let z = self.net.stations[i]
                    .zones
                    .first()
                    .copied()
                    .unwrap_or(10)
                    .min(10) as usize;
                counts[z] += 1;
            }
            let max = *counts.iter().max().unwrap_or(&1);
            let width = area.width.saturating_sub(16) as usize;
            counts
                .iter()
                .enumerate()
                .filter(|&(_, &n)| n > 0)
                .map(|(z, &n)| {
                    let label = if z == 10 {
                        "out ".to_string()
                    } else {
                        format!("Z{z:<3}")
                    };
                    Line::from(vec![
                        Span::styled(label, Style::new().fg(MUTED)),
                        Span::styled(
                            "▆".repeat((n * width).div_ceil(max)),
                            Style::new().fg(blend(ACCENT, BG, 0.25)),
                        ),
                        Span::styled(format!(" {n}"), Style::new().fg(MUTED)),
                    ])
                })
                .collect()
        };
        f.render_widget(
            Paragraph::new(body)
                .wrap(Wrap { trim: true })
                .block(Self::panel(&title)),
            area,
        );
    }

    fn draw_input(&self, f: &mut Frame, area: Rect) {
        let key = |k: &str| Span::styled(format!(" {k} "), Style::new().fg(BG).bg(MUTED).bold());
        let hint = |h: &str| Span::styled(format!(" {h}   "), Style::new().fg(MUTED));
        let (title, lines): (&str, Vec<Line>) = match &self.stage {
            Stage::Pick { query, cursor } => {
                let suggested = self
                    .suggestion()
                    .map(|s| self.net.stations[s].name.as_str())
                    .unwrap_or("");
                let mut prompt = vec![Span::styled("› ", Style::new().fg(ACCENT).bold())];
                if query.is_empty() {
                    prompt.push(Span::styled(
                        format!("type a station, or enter for {suggested}"),
                        Style::new().fg(FAINT),
                    ));
                } else {
                    prompt.push(Span::styled(query.clone(), Style::new().fg(TEXT).bold()));
                    prompt.push(Span::styled("▏", Style::new().fg(ACCENT)));
                }
                let matches = self.matches(query);
                let sel = (*cursor).min(matches.len().saturating_sub(1));
                let mut options = Vec::new();
                for (i, &m) in matches.iter().enumerate() {
                    let name = &self.net.stations[m].name;
                    let style = if i == sel {
                        Style::new().fg(BG).bg(ACCENT).bold()
                    } else if self.analysis.candidates.contains(&m) {
                        Style::new().fg(TEXT)
                    } else {
                        Style::new().fg(MUTED)
                    };
                    options.push(Span::styled(format!(" {name} "), style));
                    options.push(Span::raw(" "));
                }
                let mut help = vec![key("enter"), hint("guess"), key("↑↓"), hint("choose")];
                if self.answer.is_some() {
                    help.extend([key("space"), hint("step"), key("a"), hint("autoplay")]);
                }
                help.extend([
                    key("tab"),
                    hint("map"),
                    key("^z"),
                    hint("undo"),
                    key("esc"),
                    hint("quit"),
                ]);
                (
                    "guess",
                    vec![Line::from(prompt), Line::from(options), Line::from(help)],
                )
            }
            Stage::Feedback {
                guess,
                stops,
                zone,
                shared,
            } => {
                let s = &self.net.stations[*guess];
                let mut zones = vec![Span::styled("zone  ", Style::new().fg(MUTED))];
                for (k, z, label) in [
                    ('e', ZoneMatch::Exact, "same"),
                    ('n', ZoneMatch::Near, "next door"),
                    ('x', ZoneMatch::None, "further"),
                ] {
                    let style = if *zone == z {
                        Style::new().fg(BG).bg(zone_colour(z)).bold()
                    } else {
                        Style::new().fg(MUTED)
                    };
                    zones.push(Span::styled(format!(" {k} {label} "), style));
                    zones.push(Span::raw(" "));
                }
                let mut shared_line = vec![Span::styled("lines ", Style::new().fg(MUTED))];
                for (i, l) in line_list(s.lines).into_iter().enumerate() {
                    shared_line.push(Span::styled(
                        format!("{} ", line_key(i)),
                        Style::new().fg(MUTED),
                    ));
                    shared_line.push(line_chip(l, shared & (1 << l) != 0, false));
                    shared_line.push(Span::raw("  "));
                }
                let top = vec![
                    Span::styled(format!("{}  ", s.name), Style::new().fg(TEXT).bold()),
                    Span::styled("stops away ", Style::new().fg(MUTED)),
                    Span::styled(
                        if stops.is_empty() {
                            "__".to_string()
                        } else {
                            stops.clone()
                        },
                        Style::new().fg(ACCENT).bold().underlined(),
                    ),
                    Span::styled("   (0 if it was right)", Style::new().fg(FAINT)),
                    Span::raw("     "),
                ];
                let mut top = top;
                top.extend(zones);
                (
                    "what did the game say?",
                    vec![
                        Line::from(top),
                        Line::from(shared_line),
                        Line::from(vec![
                            key("0-9"),
                            hint("stops"),
                            key("e n x"),
                            hint("zone"),
                            key("letter"),
                            hint("toggle line shared"),
                            key("enter"),
                            hint("submit"),
                            key("esc"),
                            hint("back"),
                        ]),
                    ],
                )
            }
            Stage::Done => (
                "done",
                vec![Line::from(vec![
                    key("enter"),
                    hint("quit"),
                    key("u"),
                    hint("undo"),
                ])],
            ),
        };
        f.render_widget(Paragraph::new(lines).block(Self::panel(title)), area);
    }
}

/// Keys for toggling a guess's lines: a, b, c, d, f, g… skipping e, which sets the zone.
fn line_key(i: usize) -> char {
    let c = (b'a' + i as u8) as char;
    if c >= 'e' { (c as u8 + 1) as char } else { c }
}

fn line_list(mask: u32) -> Vec<usize> {
    (0..LINES.len()).filter(|l| mask & (1 << l) != 0).collect()
}

fn line_chip(line: usize, shared: bool, short: bool) -> Span<'static> {
    let colour = line_colour(line);
    let name = if short {
        line_code(line)
    } else {
        line_name(line)
    };
    if shared {
        Span::styled(
            format!(" {name} "),
            Style::new().fg(contrast(colour)).bg(colour).bold(),
        )
    } else {
        Span::styled(
            format!(" {name} "),
            Style::new().fg(blend(colour, BG, 0.45)).crossed_out(),
        )
    }
}

fn zone_colour(z: ZoneMatch) -> Color {
    match z {
        ZoneMatch::Exact => Color::Rgb(0x5b, 0xbd, 0x72),
        ZoneMatch::Near => Color::Rgb(0xfa, 0xa6, 0x1a),
        ZoneMatch::None => Color::Rgb(0x6a, 0x66, 0x5e),
    }
}

fn zone_chip(zones: &[u8], z: ZoneMatch) -> Span<'static> {
    let label = if zones.is_empty() {
        "out".to_string()
    } else {
        format!(
            "Z{}",
            zones
                .iter()
                .map(u8::to_string)
                .collect::<Vec<_>>()
                .join("/")
        )
    };
    Span::styled(
        format!(" {label:<4} "),
        Style::new().fg(BG).bg(zone_colour(z)).bold(),
    )
}

fn heat(stops: u8) -> Color {
    match stops {
        0 => Color::Rgb(0x5b, 0xbd, 0x72),
        1..=2 => Color::Rgb(0xff, 0x4d, 0x3d),
        3..=5 => Color::Rgb(0xff, 0x8c, 0x42),
        6..=10 => Color::Rgb(0xff, 0xd3, 0x00),
        11..=18 => Color::Rgb(0x6f, 0xb7, 0xff),
        _ => Color::Rgb(0x6a, 0x7c, 0xff),
    }
}

fn rgb(c: Color) -> (f64, f64, f64) {
    match c {
        Color::Rgb(r, g, b) => (r as f64, g as f64, b as f64),
        _ => (128.0, 128.0, 128.0),
    }
}

/// Mix `a` towards `b` by `t`.
fn blend(a: Color, b: Color, t: f64) -> Color {
    let (a, b) = (rgb(a), rgb(b));
    let mix = |x: f64, y: f64| (x + (y - x) * t).round() as u8;
    Color::Rgb(mix(a.0, b.0), mix(a.1, b.1), mix(a.2, b.2))
}

fn contrast(c: Color) -> Color {
    let (r, g, b) = rgb(c);
    if 0.299 * r + 0.587 * g + 0.114 * b > 150.0 {
        BG
    } else {
        Color::White
    }
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n - 1).collect::<String>() + "…"
    }
}

/// Bounds that frame `focus` with some margin, widened on one axis so the
/// map keeps true proportions in a terminal whose cells are twice as tall as wide.
fn fit_bounds(net: &Network, focus: &[usize], area: Rect) -> ([f64; 2], [f64; 2]) {
    let pts = focus
        .iter()
        .map(|&i| (net.stations[i].lon, net.stations[i].lat));
    let (mut x0, mut x1, mut y0, mut y1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for (x, y) in pts {
        x0 = x0.min(x);
        x1 = x1.max(x);
        y0 = y0.min(y);
        y1 = y1.max(y);
    }
    if x0 > x1 {
        return ([-0.5, 0.3], [51.3, 51.7]);
    }
    let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
    // Degrees of longitude are ~0.62 the length of degrees of latitude here.
    let kx = 0.62;
    let mut w = ((x1 - x0) * kx).max(0.02) * 1.25;
    let mut h = (y1 - y0).max(0.02) * 1.25;
    let target = area.width.max(1) as f64 / (area.height.max(1) as f64 * 2.0);
    if w / h < target {
        w = h * target
    } else {
        h = w / target
    }
    let w = w / kx;
    ([cx - w / 2.0, cx + w / 2.0], [cy - h / 2.0, cy + h / 2.0])
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{Terminal, backend::TestBackend};

    fn app(answer: Option<usize>) -> App {
        let net = Network::embedded();
        let analysis = solver::analyse(&net, &[]);
        App {
            net,
            answer,
            obs: Vec::new(),
            analysis,
            stage: Stage::Pick {
                query: String::new(),
                cursor: 0,
            },
            full_map: false,
            autoplay: false,
            last_step: Instant::now(),
        }
    }

    fn render(app: &App) -> String {
        let mut terminal = Terminal::new(TestBackend::new(160, 44)).unwrap();
        terminal.draw(|f| app.draw(f)).unwrap();
        let buf = terminal.backend().buffer();
        (0..buf.area.height)
            .map(|y| {
                (0..buf.area.width)
                    .map(|x| buf[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn demo_solves_and_renders() {
        let net = Network::embedded();
        let mut app = app(net.find("Bank"));
        println!("{}", render(&app));
        app.demo_step();
        println!("{}", render(&app));
        while !matches!(app.stage, Stage::Done) {
            app.demo_step();
        }
        println!("{}", render(&app));
        assert!(app.obs.last().unwrap().feedback.is_win());
    }

    #[test]
    fn hard_game_renders() {
        let net = Network::embedded();
        let hard = (0..net.len())
            .find(|&a| solver::play(&net, a, None).len() >= 4)
            .unwrap();
        let mut app = app(Some(hard));
        for _ in 0..3 {
            app.demo_step();
        }
        println!("{}", render(&app));
    }

    #[test]
    fn feedback_entry() {
        let mut app = app(None);
        let press = |app: &mut App, c: KeyCode| {
            app.on_key(KeyEvent::new(c, KeyModifiers::NONE));
        };
        press(&mut app, KeyCode::Enter);
        for c in ['7', 'n', 'a'] {
            press(&mut app, KeyCode::Char(c));
        }
        println!("{}", render(&app));
        press(&mut app, KeyCode::Enter);
        assert_eq!(app.obs.len(), 1);
        assert_eq!(app.obs[0].feedback.stops, 7);
        assert_eq!(app.obs[0].feedback.zone, ZoneMatch::Near);
        assert_eq!(app.obs[0].feedback.shared.count_ones(), 1);
    }
}
