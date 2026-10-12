# Pathway files for ministries

A **pathway** is an ordered list of studies, such as "New Believers: six studies over twelve weeks". Ministries can publish their own pathways so users see them in the app's **Library → Paths** tab. Users can set one as their active pathway and track progress across its studies on **My Progress**.

Start from [`pathway-template.epathway`](pathway-template.epathway). Fill in every value marked `REPLACE`. The `_help` notes in it explain each field, and the app ignores them.

## Delivering it to users

There are two ways, and both use the app's normal **Load from device** button:

1. **A standalone file:** save it with the `.epathway` extension and share it.
2. **Inside a bundle zip:** put it at the root of the zip, named `pathways.json`, next to your `.estudy` files. The app installs the studies first and then the pathways, so users get everything in one file.

The app shows the user what they are about to add before saving anything. It shows:
- your publisher name, labelled *self-declared*;
- the group and pathway titles;
- the number of studies;
- the version.

On Android, opening a `.epathway` file directly from the Files app may not work yet. Ask users to open it with the app's **Load from device** button, or send a bundle zip instead.

## Structure

```
group  (title, description, publisher)        → a heading in the Paths tab
  └─ pathways[]  (title, description, optional bundle link)
       └─ studies[]  (studyId, title, description, optional download link)
```

| Field | Required | Rules |
|---|---|---|
| `estudyPathwayFileVersion` | yes | Always `1`. |
| `groupId` | yes | Permanent ID for your ministry. Letters, digits, `.`, `_` and `-` only, up to 64 characters. |
| `version` | yes | A number. Raise it each time you publish a change. |
| `publisher.name` | no | Up to 200 characters. |
| `title` | yes | Up to 200 characters. |
| `description` | no | Plain text, up to 5,000 characters. |
| `pathways[].pathwayId` | yes | Unique within the file. Same rules as `groupId`. |
| `pathways[].title` | yes | Up to 200 characters. |
| `pathways[].downloadLocation` | no | A link to a bundle zip of the pathway's studies. |
| `studies[].studyId` | yes | Must match `studyMetadata.studyId` inside the `.estudy` file. Unique within its pathway. |
| `studies[].title` | yes | Up to 200 characters. |
| `studies[].downloadLocation` | no | A link to the `.estudy` file. |

**Limits:**
- the file can be at most 256 KB;
- a group can have at most 20 pathways;
- a pathway can have at most 100 studies.

## Text in several languages

Any `title` or `description` can be either:
- a single piece of text, for one language: `"title": "New Believers"`; or
- one version per language code: `"title": { "en": "New Believers", "fr": "Nouveaux croyants" }`.

The app shows the user's language if you've provided it, then English, then the first language you listed.

Text is always shown exactly as typed. HTML tags and markdown are not formatted.

## Download links

- They must start with `https://`.
- They must be on a public website: no IP addresses, `localhost`, local-network names, or `user:password@` in the link.
- Google Drive share links work.
- Tapping a download button opens the link in the user's web browser after a confirmation. The user then opens the downloaded file with the app.
- If a link is missing, the study shows as "not available". Its studies can still be added any other way.

## Updating a published pathway

Change the file, **increase `version`**, and redistribute it.

- If a user has an older version, it is replaced.
- If a user already has the same or a newer version, the file is skipped.

Keep `groupId` and each `pathwayId` the same between versions.
- If you remove or rename a pathway that a user had set active, their active pathway is cleared.
- Their studies and answers are never affected.

## Removing

Users can remove an imported pathway with the bin icon next to it in the Paths tab. This removes only the pathway. Installed studies, answers and progress stay.

## If the app rejects the file

The error message names the problem, for example "The ID in “groupId” is invalid" or "The link in “pathways[0].downloadLocation” isn't allowed". Common causes:
- a missing required field;
- an ID with spaces or other unsupported characters;
- the same ID used twice;
- an `http://` link;
- text over the length limits;
- invalid JSON, such as a missing comma or a stray quote.

A JSON validator such as [jsonlint.com](https://jsonlint.com) helps find syntax errors.
