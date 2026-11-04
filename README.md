# tubele-solver

A terminal solver for [Tubele](https://tubele.app), the daily London station guessing game.

It plays within the rules of the game. It knows the network map, built from the TfL Unified API,
and nothing else: not the answer schedule, not which stations the game favours as answers. Each
guess returns what the game shows a player, and the solver keeps only the stations consistent with
every clue so far.

## Usage

```bash
cargo run --release                         # play today's game at tubele.app by itself
cargo run --release -- auto --start Bank    # …opening with a chosen station
cargo run --release -- auto --show          # …with the browser window visible
cargo run --release -- play                 # play it yourself, typing in what the game says
cargo run --release -- demo [station]       # watch it solve a hidden station offline
cargo run --release -- bench                # play every station and report the spread
cargo run --release -- fetch                # rebuild data/network.json from TfL
```

`auto` drives the live site in a headless Chromium-based browser (Chrome, Helium, Brave, Edge or a
Playwright download; `TUBELE_BROWSER` overrides). It types each guess into the page and reads the
feedback row the page renders, the same information a player sees. Each run uses a fresh browser
profile, so it plays the daily puzzle from the start every time, and requests to the game's
analytics endpoint are blocked so the solver's games do not count in its statistics.

Without `--start`, choose the opener in the UI: enter takes the solver's pick, typing searches,
`1`–`9` picks a random station in that fare zone and `?` a random station anywhere. The solver
plays the rest. `tab` switches the map between the remaining candidates and the whole network.

In `play`, enter what the game reported after each guess: stops away, the zone colour (`e` same,
`n` adjacent, `x` neither), and a letter for each line marked as shared. `0` stops means the guess
was right; `ctrl-z` undoes a guess.

## How it works

**Clues.** Each guess yields the fewest stops between guess and answer (changing lines is free),
whether their fare zones match, are adjacent or neither, and which of the guess's lines the answer
is also on.

**Elimination.** A station stays a candidate only if, had it been the answer, every previous guess
would have produced exactly the clues observed. If the map here ever disagrees with the game's
(TfL rerouting a line, say) and nothing fits exactly, the solver keeps the stations that disagree
least and says so in the header, rather than finding no answer.

**Choosing a guess.** Every unguessed station is scored by how it would split the remaining
candidates into groups by clue. The score is the expected number of candidates left afterwards,
counting a correct guess as zero left, so a guess that might win outright competes fairly with one
that only narrows the field. Any station can be suggested, including ones already ruled out,
because a non-candidate sometimes splits the field better. Ties go to a guess that could be the
answer.

With a uniform prior over all stations, the bench solves every station within five guesses and
averages about 2.7.

**The map.** `fetch` follows the same conventions as the game: stops sharing a cleaned name within
600 m are one station (King's Cross St Pancras, Paddington's H&C platforms), while the two Edgware
Roads and two Hammersmiths stay separate. Adjacency comes from TfL's route sequences. The network
has 34 stops between its furthest stations, matching the game's published diameter.

Testing: `cargo test` runs offline. `cargo test -- --ignored` also plays the live daily game once
through the browser.
