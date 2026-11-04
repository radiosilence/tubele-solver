# tubele-solver

A terminal solver for [Tubele](https://tubele.app), the daily London station guessing game.

It plays within the rules of the game. It knows the network map, built from the TfL Unified API,
and nothing else: not the answer schedule, not which stations the game favours as answers. Each
guess returns what the game shows a player, and the solver keeps only the stations consistent with
every clue so far.

## Usage

```bash
cargo run --release              # solve today's game alongside the browser
cargo run --release -- demo      # watch it solve a random station
cargo run --release -- demo Bank # …or a chosen one
cargo run --release -- bench     # play every station and report the spread
cargo run --release -- fetch     # rebuild data/network.json from TfL
```

In `play`, press enter to take the suggested guess (or type another station), type the same guess
into the game, then enter what the game reported: stops away, the zone colour (`e` same, `n`
adjacent, `x` neither), and which of the guessed station's lines it marked as shared. `0` stops
means the guess was right. `tab` switches the map between the remaining candidates and the whole
network; `ctrl-z` undoes a guess.

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
