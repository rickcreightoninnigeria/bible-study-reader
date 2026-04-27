# Shelves Structure Validator (`shelves_validation.py`)

This script is a specialized Quality Assurance tool for the library shelf data. Because the library structure uses nested arrays and rich text descriptions, standard key-syncing scripts aren't enough. This script inspects the **content** of the strings.

## What it validates:
1. **JSON Integrity**: Checks if the file is valid JSON (no missing commas or brackets).
2. **HTML Consistency**: Ensures that tags like `<b>` or `<i>` are correctly closed. This prevents "bleeding" styles where a whole page accidentally becomes bold.
3. **Placeholder Safety**: Detects mismatched curly braces `{ }`. If a translator accidentally types `{count` (missing the closer), the app might fail to inject the correct number.

## How to use:
1. Run your `shelves_csv_to_json.py` script to generate your translated files.
2. Ensure the translated files (e.g., `libraryShelvesStructure_ms.json`) are in the same folder as this script.
3. Run the validator:
   ```bash
   python shelves_validation.py
   ```
4. **Review results**:
   - `✅ Perfect`: The file is safe to use.
   - `❌ Broken HTML`: You need to fix the tags in that specific JSON or the source CSV.
   - `⚠️ Mismatched curly braces`: A variable placeholder is likely broken.

## Why this is necessary:
Unlike UI strings, which are short, shelf descriptions are long paragraphs. Translators are much more likely to make a typo in an HTML tag or a variable placeholder when dealing with long-form text. This script catches those errors before they reach the app.

### Recommendation on Workflow:
I suggest running this **every time** you download a new translation from Google. Google Translate is generally good, but it frequently adds spaces inside tags (e.g., `< b >` instead of `<b>`) or changes curly braces to square ones. This script will save you from having to debug why a specific language is crashing the library view.