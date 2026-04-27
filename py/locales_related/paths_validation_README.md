# Pathways Validator (`paths_validation.py`)

This script ensures that your translated Learning Pathways files are technically sound before they are deployed to the app.

## Why use this?
The `learningPathways` files use a three-level hierarchy. If a single closing bracket `]` or brace `}` is misplaced during translation, the entire pathway system might fail to load. This script catches those errors instantly.

## What is checked:
1. **HTML Integrity**: Validates that all `<b>`, `<i>`, and other tags are properly opened and closed within descriptions.
2. **Variable Safety**: Checks that placeholders like `{title}` haven't been corrupted (e.g., changing into `{title` or `(title)`).
3. **Array Structure**: Confirms the JSON remains a valid array-of-objects structure.

## Usage:
1. Generate your translated JSON using `lp_csv_to_json.py`.
2. Run the validator:
   ```bash
   python paths_validation.py
   ```
3. If an error is reported at a path like `root.learningPathways[0].pathways[2].description`, you can navigate directly to that object in your JSON to fix it.


### Should you use the UI Sync/Import scripts for Paths?
Just like with the "Shelves" data, **no**. 

The Learning Pathways file is a "Content Tree." The UI scripts are built for "Key Lists."
* If you use a **Sync** script on Pathways, it might see two different descriptions and try to overwrite one with the other because they both share the key name `"description"`.
* The **CSV $\leftrightarrow$ JSON** mapping method you currently have for Pathways is the correct way to handle this data. The only thing you needed was this **Validation** step to ensure the human (or AI) translator didn't leave a typo in the text.