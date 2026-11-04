# tubele-solver

A terminal solver for [Tubele](https://tubele.app), the daily London station guessing game.

It plays within the rules of the game. It knows the network map, built from the TfL Unified API,
and nothing else: not the answer schedule, not which stations the game favours as answers. Each
guess returns what the game shows a player, and the solver keeps only the stations consistent with
every clue so far.

A long-form, interactive account of the method and results, including a comparison with players'
results, is at [radiosilence.github.io/tubele-solver](https://radiosilence.github.io/tubele-solver/).
Its figures are computed by `docs/build` from `data/network.json`.

## Install

```bash
brew install radiosilence/tap/tubele-solver
# or
mise use -g github:radiosilence/tubele-solver
```

Releases carry macOS arm64 and static Linux binaries. Shell completions come with the Homebrew
formula; otherwise `tubele-solver --completions zsh` (or bash, fish, elvish, powershell) prints
one.

## Usage

```bash
tubele-solver                               # play today's game at tubele.app by itself
tubele-solver auto --start Bank             # …opening with a chosen station
tubele-solver auto --start zone:2           # …opening with a random zone 2 station
tubele-solver auto --practice 10            # …then ten practice rounds
tubele-solver auto --show                   # …with the browser window visible
tubele-solver play                          # play it yourself, typing in what the game says
tubele-solver demo [station]                # watch it solve a hidden station offline
tubele-solver bench                         # play every station and report the spread
tubele-solver openers                       # rank every station as an opening guess
tubele-solver fetch                         # rebuild data/network.json from TfL
```

`auto` drives the live site in a headless Chromium-based browser (Chrome, Helium, Brave, Edge or a
Playwright download; `TUBELE_BROWSER` overrides). It types each guess into the page and reads the
feedback row the page renders, the same information a player sees. Each run uses a fresh browser
profile, so it plays the daily puzzle from the start every time, and requests to the game's
analytics endpoint are blocked so the solver's games do not count in its statistics.

Without `--start`, choose the opener in the UI: enter takes the solver's pick, typing searches,
`1`–`9` picks a random station in that fare zone and `?` a random station anywhere. The solver
plays the rest. `tab` switches the map between the remaining candidates and the whole network.

Practice rounds unlock once the daily game is finished, so `--practice` plays the daily first and
then asks the page for another round each time; `n` does the same by hand. Later rounds open with
`--start` if given (drawn afresh for `random` and `zone:N`), otherwise with the solver's pick. The
header keeps a running tally.

In `play`, enter what the game reported after each guess: stops away, the zone colour (`e` same,
`n` adjacent, `x` neither), and a letter for each line marked as shared. `0` stops means the guess
was right; `ctrl-z` undoes a guess.

## How it works

**Clues.** Each guess yields the fewest stops between guess and answer (changing lines is free),
whether their fare zones match, are adjacent or neither, and which of the guess's lines the answer
is also on.

**Service information.** The live board shows the answer's transport mode from the start, then
reveals one more fact after each wrong guess: fare zone, its role on the network (end of the line,
interchange or through station), one of its lines, stops from the end of that line, and its first
letter. `auto` scrapes the panel and treats each fact as a hard constraint, computed from the local
map: a station's role from its neighbour and line counts, and stops from the end by a breadth-first
search from each line's ends along that line only. `demo` and `bench` reveal the same facts in the
same order. `play` does not ask for them.

The clues are worth almost half a guess. Over all 420 answers the mean falls from 2.71 to 2.26
guesses and the worst case from five to four, with 72% solved in two. The mode also changes the best
opener: King's Cross St. Pancras for Underground answers, Clapham Junction for Overground, Devons
Road for DLR, and any of several Elizabeth line stations east of Stratford.

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

**Openers.** `openers` plays every station as the opener against every station as the answer,
with the solver taking over from guess two, all offline on the local map. Stratford is best on
average (2.71 guesses): its five lines reach most of the network within a few stops, so the stop
count alone splits the field finely. Liverpool Street, Bank, Canary Wharf and Barking are slightly
worse on average but never need a fifth guess. Openers at the ends of lines are the weakest; from
Chesham most of the network sits at similar distances, so the first clue rules out little.

**The map.** `fetch` follows the same conventions as the game: stops sharing a cleaned name within
600 m are one station (King's Cross St Pancras, Paddington's H&C platforms), while the two Edgware
Roads and two Hammersmiths stay separate. Adjacency comes from TfL's route sequences. The network
has 34 stops between its furthest stations, matching the game's published diameter.

Testing: `cargo test` runs offline. `cargo test -- --ignored` also plays the live daily game once
through the browser.
