# Introducing Ecclesiastes: release checklist

Study ID: `introducing_ecclesiastes_v001`. Current version: 1.00 (not yet released).

## A. Before release

1. **Testing done.** Tester feedback has been logged in `introducing_ecclesiastes_feedback_log.md`, and every item has a decision (change, no change, later).
2. **Plan is the source.** Every change is in `introducing_ecclesiastes_v001_plan.md` first, and `study.json` has been rebuilt from it. Nothing has been edited in the JSON by hand.
3. **Validator.** Run `python3 validate_study.py study.json`. It must report 0 errors. Read every warning.
4. **Check in the app** (STUDY-FORMAT section 13, item 12): a passage pop-up, a hint, the Check button, the Main point button, a catch-up box, a Leaders' Notes page (switched on under Settings, App, Optional Pages), the NET links, the copyright page and the About page, at phone width and in dark mode.
5. **Study ID.** Confirm that no study already in the library has an ID that is a prefix of `introducing_ecclesiastes_v001`, or that starts with it. Rick confirmed the ID `introducing_ecclesiastes_v001` (2026-10-26); the prefix check against the repository's existing IDs is still to be done, because the list has not yet been supplied. (STUDY-FORMAT section 5: one ID must never be a prefix of another, or deleting or clearing one study could affect the other's saved answers.)
6. **Library shelf.** The shelf is Old Testament, Poetry & Wisdom, Ecclesiastes. Confirm it still exists in `libraryShelvesStructure_en.json`.

## B. Rights and notices

1. **Licence.** The study is CC BY-SA 4.0. The app prints that text on the copyright page, and no `licenceText` is supplied.
2. **NET.** The notice reads "used with permission from Biblical Studies Press". The NET terms allow free, non-commercial distribution with the acknowledgement and the NET designation. Under those terms "free" means free: the study must not be sold, bundled with anything sold, or used to solicit donations. **Confirmed by Rick (2026-10-26):** BeaconLight's free distribution fits these terms.
3. **Sources line.** It lists the six works consulted. Check that you are content with the list.
4. **AI-assistance note.** It is in the publisher paragraphs on the About page. Check the wording.
5. **Not for the repository.** Keep out of the app repository: the plan's Part 3 (editorial notes), any source notes, and the six source books or extracts. The plan file as a whole contains Part 3, so store it outside the repository, or remove Part 3 from any copy that goes in.

## C. What goes in the repository

1. `study.json`, as the plain-JSON study. **Decided by Rick (2026-10-26):** package as JSON, not `.estudy`.
2. Nothing else from this project: not the plan, the tester pack, or this checklist.

## D. After release: changing the study

1. Put the change in the plan (Part 1 or Part 2).
2. Raise `studyVersion` in the plan's header, using two decimal places: 1.00, then 1.01, 1.02 ... 1.09, 1.10.
3. Rebuild `study.json` from the plan, run the validator, and record the change.
4. Readers who already have the study are offered the newer file. If the version is the same or lower, the app asks them whether to keep what they have, so an update with no version change will not reach anyone by accident.

## E. Release record

| Date | Version | What changed | Validator result | Who released |
|---|---|---|---|---|
| | 1.00 | First release | | |
