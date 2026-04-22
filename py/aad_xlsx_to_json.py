import json
import pandas as pd
import re
import os

# --- SETTINGS ---
# Note: Ensure these paths match your local environment
INPUT_XLSX = '/home/rick/Downloads/aad_translate.xlsx'
MAP_FILE = 'aad_map.json'
ORIGINAL_JSON = '../app/js/locales/en/appAboutData_en.json'
OUTPUT_JSON = 'appAboutData_translated.json'

def unprotect(text):
    """Removes the protection tags added for translation."""
    if pd.isna(text): return ""
    text = str(text)
    # Restore placeholders by stripping the protection span tags
    text = re.sub(r'<span class="notranslate">(.*?)</span>', r'\1', text)
    # Catch edge cases where Google might have added spaces in the tags
    return text.replace('<span class = "notranslate">', '').replace('</span>', '')

def set_by_path(data, path, value):
    """
    Navigates a nested dictionary/list using a string path and sets a value.
    Filters out empty segments caused by the split operation.
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
    # Check if required files exist
    if not os.path.exists(INPUT_XLSX):
        print(f"❌ Error: {INPUT_XLSX} not found.")
        return
    if not os.path.exists(MAP_FILE):
        print(f"❌ Error: {MAP_FILE} not found.")
        return

    print(f"🔄 Processing {INPUT_XLSX}...")

    # 1. Load the original English source
    try:
        with open(ORIGINAL_JSON, 'r', encoding='utf-8') as f:
            final_data = json.load(f)
    except Exception as e:
        print(f"❌ Error loading source JSON: {e}")
        return

    # 2. Load the translated Excel file
    try:
        df = pd.read_excel(INPUT_XLSX)
        # Use column index 1 (second column) to ignore translated headers
        translated_texts = df.iloc[:, 1].apply(unprotect).tolist()
    except Exception as e:
        print(f"❌ Error reading Excel file: {e}")
        return

    # 3. Load the mapping coordinates
    with open(MAP_FILE, 'r', encoding='utf-8') as f:
        mapping = json.load(f)

    # 4. Re-insert the translated text into the JSON structure
    for i, entry in enumerate(mapping):
        if i < len(translated_texts):
            # FIXED: Uses 'Path' (capitalized) to match the key in aad_map.json
            set_by_path(final_data, entry['Path'], translated_texts[i])

    # 5. Save the finished JSON
    try:
        with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
            json.dump(final_data, f, indent=2, ensure_ascii=False)
        print(f"✅ Success! Created {OUTPUT_JSON}")
        
        json_saved = True
    except Exception as e:
        print(f"❌ Failed to save JSON: {e}")
        json_saved = False

    # 6. FINAL CLEANUP: Delete the translated XLSX file
    # Only deletes if the JSON was successfully saved to prevent data loss
    if json_saved:
        try:
            os.remove(INPUT_XLSX)
            print(f"🗑️  Cleaned up: {INPUT_XLSX} has been deleted.")
        except OSError as e:
            print(f"⚠️  Note: Could not delete {INPUT_XLSX} (it might be open in Excel): {e}")

if __name__ == "__main__":
    run()