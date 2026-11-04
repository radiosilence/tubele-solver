use crate::network::{LINES, Network, Role, line_mode};
use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum ZoneMatch {
    Exact,
    Near,
    None,
}

impl ZoneMatch {
    pub fn between(guess: &[u8], answer: &[u8]) -> Self {
        if guess.is_empty() || answer.is_empty() {
            return if guess.is_empty() == answer.is_empty() {
                Self::Exact
            } else {
                Self::None
            };
        }
        if guess.iter().any(|z| answer.contains(z)) {
            Self::Exact
        } else if guess
            .iter()
            .any(|z| answer.contains(&(z + 1)) || (*z > 0 && answer.contains(&(z - 1))))
        {
            Self::Near
        } else {
            Self::None
        }
    }
}

/// Everything the game tells you about one guess.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Feedback {
    pub stops: u8,
    pub zone: ZoneMatch,
    /// The guessed station's lines that the answer is also on.
    pub shared: u32,
}

impl Feedback {
    pub fn compute(net: &Network, guess: usize, answer: usize) -> Self {
        let (g, a) = (&net.stations[guess], &net.stations[answer]);
        Self {
            stops: net.dist(guess, answer),
            zone: ZoneMatch::between(&g.zones, &a.zones),
            shared: g.lines & a.lines,
        }
    }

    pub fn is_win(&self) -> bool {
        self.stops == 0
    }
}

#[derive(Clone, Copy)]
pub struct Observation {
    pub guess: usize,
    pub feedback: Feedback,
}

/// How far a candidate is from explaining an observation. Zero means fully
/// consistent. Non-zero values only matter when the map here disagrees with
/// the game's and nothing is fully consistent: the solver then keeps the
/// candidates that disagree least instead of giving up.
fn penalty(net: &Network, obs: &Observation, candidate: usize) -> u32 {
    let f = Feedback::compute(net, obs.guess, candidate);
    let mut p = f.stops.abs_diff(obs.feedback.stops) as u32;
    if f.zone != obs.feedback.zone {
        p += 3;
    }
    p += 3 * (f.shared ^ obs.feedback.shared).count_ones();
    p
}

pub struct Analysis {
    /// Stations still possible, in name order.
    pub candidates: Vec<usize>,
    /// 0 when the candidates fit every clue exactly.
    pub mismatch: u32,
    /// Ranked suggestions, best first.
    pub ranked: Vec<Suggestion>,
}

#[derive(Clone, Copy)]
pub struct Suggestion {
    pub station: usize,
    /// Expected number of candidates left after this guess, counting a win as 0.
    pub expected_left: f64,
    /// Bits of information the guess is expected to reveal.
    pub entropy: f64,
    pub worst_case: usize,
    pub could_win: bool,
}

/// `skip` holds stations the game refused as guesses: they cannot be answers
/// either, and are never suggested.
pub fn analyse(
    net: &Network,
    observations: &[Observation],
    skip: &[usize],
    clues: &Clues,
) -> Analysis {
    let mut guessed: Vec<usize> = observations.iter().map(|o| o.guess).collect();
    guessed.extend_from_slice(skip);
    let scored: Vec<(usize, u32)> = (0..net.len())
        .filter(|s| {
            !guessed.contains(s)
                || observations
                    .iter()
                    .any(|o| o.guess == *s && o.feedback.is_win())
        })
        .map(|s| {
            let p: u32 = observations.iter().map(|o| penalty(net, o, s)).sum();
            (s, p + 3 * clues.violations(net, s))
        })
        .collect();
    let mismatch = scored.iter().map(|&(_, p)| p).min().unwrap_or(0);
    let candidates: Vec<usize> = scored
        .iter()
        .filter(|&&(_, p)| p == mismatch)
        .map(|&(s, _)| s)
        .collect();
    let ranked = rank(net, &candidates, &guessed);
    Analysis {
        candidates,
        mismatch,
        ranked,
    }
}

/// Score every unguessed station as the next guess against the candidate set.
///
/// The primary score is the expected number of candidates left afterwards,
/// with a correct guess counting as none left. That folds "might win now" and
/// "splits the rest well" into one number. Ties go to guesses that could be
/// the answer, then to higher entropy.
pub fn rank(net: &Network, candidates: &[usize], guessed: &[usize]) -> Vec<Suggestion> {
    let n = candidates.len() as f64;
    if candidates.len() <= 2 {
        return candidates
            .iter()
            .map(|&s| Suggestion {
                station: s,
                expected_left: (n - 1.0) / n,
                entropy: n.log2(),
                worst_case: candidates.len() - 1,
                could_win: true,
            })
            .collect();
    }
    let mut buckets: HashMap<Feedback, usize> = HashMap::with_capacity(64);
    let mut out: Vec<Suggestion> = (0..net.len())
        .filter(|g| !guessed.contains(g))
        .map(|g| {
            buckets.clear();
            for &c in candidates {
                *buckets.entry(Feedback::compute(net, g, c)).or_default() += 1;
            }
            let mut sum_sq = 0.0;
            let mut entropy = 0.0;
            let mut worst = 0;
            for (f, &count) in &buckets {
                let c = count as f64;
                entropy -= c / n * (c / n).log2();
                if !f.is_win() {
                    sum_sq += c * c;
                    worst = worst.max(count);
                }
            }
            Suggestion {
                station: g,
                expected_left: sum_sq / n,
                entropy,
                worst_case: worst,
                could_win: candidates.contains(&g),
            }
        })
        .collect();
    out.sort_by(|a, b| {
        a.expected_left
            .total_cmp(&b.expected_left)
            .then(b.could_win.cmp(&a.could_win))
            .then(b.entropy.total_cmp(&a.entropy))
            .then(a.station.cmp(&b.station))
    });
    out
}

/// Play one game against a known answer using only what the game shows: the
/// feedback rows and, when `with_clues`, the service-information panel.
pub fn play(
    net: &Network,
    answer: usize,
    opener: Option<usize>,
    with_clues: bool,
) -> Vec<Observation> {
    let mut obs = Vec::new();
    loop {
        let clues = if with_clues {
            Clues::reveal(net, answer, obs.len())
        } else {
            Clues::default()
        };
        let guess = match (obs.is_empty(), opener) {
            (true, Some(o)) => o,
            _ => analyse(net, &obs, &[], &clues).ranked[0].station,
        };
        let feedback = Feedback::compute(net, guess, answer);
        obs.push(Observation { guess, feedback });
        if feedback.is_win() || obs.len() >= 20 {
            return obs;
        }
    }
}

/// The game's "service information" panel: the answer's transport mode from
/// the start, then one more fact after each wrong guess.
#[derive(Clone, Default, Debug, PartialEq)]
pub struct Clues {
    /// Index into `network::MODE_NAMES`.
    pub mode: Option<usize>,
    /// Exact fare zones; empty means outside them.
    pub zones: Option<Vec<u8>>,
    pub role: Option<Role>,
    /// One of the answer's lines.
    pub line: Option<usize>,
    /// Stops from the end of `line`.
    pub end_stops: Option<u8>,
    pub letter: Option<char>,
}

/// The game's stable pick: a 31-multiplier string hash of the name over its
/// UTF-16 units, modulo the number of choices.
fn pick_stable<T: Copy>(items: &[T], name: &str) -> T {
    let mut h: u32 = 7;
    for c in name.encode_utf16() {
        h = h.wrapping_mul(31).wrapping_add(c as u32);
    }
    items[h as usize % items.len()]
}

pub fn end_stops(net: &Network, station: usize, line: usize) -> u8 {
    let by_line = net.end_stops[station][line];
    if by_line != u8::MAX {
        return by_line;
    }
    net.end_stops[station]
        .iter()
        .copied()
        .min()
        .unwrap_or(u8::MAX)
}

impl Clues {
    /// How many clues `station` contradicts.
    pub fn violations(&self, net: &Network, station: usize) -> u32 {
        let s = &net.stations[station];
        let lines = (0..LINES.len()).filter(|l| s.lines & (1 << l) != 0);
        let mut v = 0;
        if let Some(m) = self.mode
            && !lines.clone().any(|l| line_mode(l) == m)
        {
            v += 1;
        }
        if let Some(z) = &self.zones
            && *z != s.zones
        {
            v += 1;
        }
        if let Some(r) = self.role
            && r != net.roles[station]
        {
            v += 1;
        }
        if let Some(l) = self.line {
            if s.lines & (1 << l) == 0 {
                v += 1;
            } else if let Some(e) = self.end_stops
                && e != end_stops(net, station, l)
            {
                v += 1;
            }
        }
        if let Some(c) = self.letter
            && !s
                .name
                .chars()
                .next()
                .is_some_and(|f| f.eq_ignore_ascii_case(&c))
        {
            v += 1;
        }
        v
    }

    /// What the game shows about `answer` after `wrong` incorrect guesses.
    pub fn reveal(net: &Network, answer: usize, wrong: usize) -> Self {
        let s = &net.stations[answer];
        let mut ids: Vec<(&str, usize)> = (0..LINES.len())
            .filter(|l| s.lines & (1 << l) != 0)
            .map(|l| (LINES[l].0, l))
            .collect();
        ids.sort();
        let mut modes: Vec<usize> = ids.iter().map(|&(_, l)| line_mode(l)).collect();
        modes.sort();
        modes.dedup();
        let line = pick_stable(&ids, &s.name).1;
        Self {
            mode: Some(pick_stable(&modes, &s.name)),
            zones: (wrong >= 1).then(|| s.zones.clone()),
            role: (wrong >= 2).then(|| net.roles[answer]),
            line: (wrong >= 3).then_some(line),
            end_stops: (wrong >= 4).then(|| end_stops(net, answer, line)),
            letter: (wrong >= 5).then(|| s.name.chars().next().unwrap_or(' ')),
        }
    }
}
