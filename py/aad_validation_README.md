# App About Data Validator (`aad_validation.py`)

This script provides Quality Assurance for your app's metadata and licensing information (`appAboutData_*.json`).

## Why is this important?
The `appAboutData` file contains legal notices and license conditions (CC-BY-SA-4.0). It is critical that:
1.  **HTML doesn't break**: If a notice uses `<i>` or `<b>`, a broken tag could ruin the display of the entire About screen.
2.  **Placeholders remain functional**: If you use placeholders like `{appTitle}` in your descriptions, they must remain in the `{}` format to be replaced correctly by the app.

## What is checked:
-   **JSON Syntax**: Ensures the file is readable by the app.
-   **HTML Tags**: Ensures all formatting tags are properly opened and closed.
-   **Brace Balance**: Checks that every opening `{` has a corresponding `}`.

## Usage:
1.  Place your translated files (e.g., `appAboutData_ru.json`) in the same folder as the script.
2.  Run the script:
    ```bash
    python aad_validation.py
    ```
3.  Fix any reported issues in the JSON or the source CSV and re-run until you see the `✅ Pass` message.

### Why "aad_" also uses the Mapping method
Similar to the Shelves and Pathways data, your appAboutData is a structured document. The Sync and Import scripts used for the UI are not appropriate here because:

The appAboutData structure is unique and contains arrays (like freedoms).

A "Sync" script would struggle to match array items if the order changed.

The CSV ↔ JSON mapping scripts you have are specifically built to handle these arrays safely by indexing every specific row.