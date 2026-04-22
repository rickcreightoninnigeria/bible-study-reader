import json
import pandas as pd
import re
import os

# --- CONFIGURATION ---
# The file you download from Google Translate
INPUT_XLSX = '/home/rick/Downloads/shelves_translate.xlsx'
# The map generated during the extraction phase
MAP_FILE = 'shelves_map.json'
# The original English file used as a structural template
ORIGINAL_JSON = '../app/js/locales/en/libraryShelvesStructure_en.json'
# The final translated result
OUTPUT_JSON = 'libraryShelvesStructure_translated.json'

def unprotect(text):
    """
    Removes the protection tags and cleans up common 
    Machine Translation artifacts (like extra spaces).
    """
    if pd.isna(text): return ""
    text = str(text)
    # Restore placeholders by stripping the protection span tags
    text = re.sub(r'<span class="notranslate">(.*?)</span>', r'\1', text)
    # Fix cases where the engine might have added spaces: <span class = "notranslate">
    return text.replace('<span class = "notranslate">', '').replace('</span>', '')

def set_by_path(data, path, value):
    """
    Navigates a complex JSON structure (dicts and lists) 
    using a string path and sets the value, filtering out empty path segments.
    """
    # Fix: Filter out empty strings created by the split
    parts = [p for p in path.replace('[', '.[').split('.') if p]
    
    current = data
    # Navigate to the parent of the target key/index
    for part in parts[:-1]:
        if part.startswith('['):
            current = current[int(part[1:-1])]
        else:
            current = current[part]
    
    # Set the value on the final target
    last = parts[-1]
    if last.startswith('['):
        current[int(last[1:-1])] = value
    else:
        current[last] = value

def run():
    # Verify both input files exist before starting
    if not os.path.exists(INPUT_XLSX):
        print(f"❌ Error: {INPUT_XLSX} not found.")
        return
    if not os.path.exists(MAP_FILE):
        print(f"❌ Error: {MAP_FILE} not found.")
        return

    print(f"🔄 Reconstructing JSON from {INPUT_XLSX}...")

    # 1. Load the original English structure to use as a base
    with open(ORIGINAL_JSON, 'r', encoding='utf-8') as f:
        final_data = json.load(f)

    # 2. Load the translated Excel data
    try:
        df = pd.read_excel(INPUT_XLSX)
        # Use column index 1 (the second column) to ignore translated headers
        translated_texts = df.iloc[:, 1].apply(unprotect).tolist()
    except Exception as e:
        print(f"❌ Error reading Excel file: {e}")
        return

    # 3. Load the mapping instructions
    with open(MAP_FILE, 'r', encoding='utf-8') as f:
        mapping = json.load(f)

    # 4. Map the translated rows back to the JSON paths
    for i, entry in enumerate(mapping):
        if i < len(translated_texts):
            set_by_path(final_data, entry['path'], translated_texts[i])

    # 5. Save the resulting translated JSON
    json_saved = False
    try:
        with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
            json.dump(final_data, f, indent=2, ensure_ascii=False)
        print(f"✅ Success! Created {OUTPUT_JSON}")
        json_saved = True
    except Exception as e:
        print(f"❌ Failed to save JSON: {e}")

    # 6. CLEANUP: Delete the XLSX file only if the JSON was successfully saved
    if json_saved:
        try:
            os.remove(INPUT_XLSX)
            print(f"🗑️  Cleaned up: {INPUT_XLSX} has been deleted.")
        except OSError as e:
            print(f"⚠️  Note: Could not delete {INPUT_XLSX} (it may be open in Excel): {e}")

if __name__ == "__main__":
    run()
