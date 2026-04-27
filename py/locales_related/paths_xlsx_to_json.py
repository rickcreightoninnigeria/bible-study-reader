import json
import pandas as pd
import re
import os

# --- CONFIGURATION ---
# The file downloaded from Google Translate
INPUT_XLSX = '/home/rick/Downloads/paths_translate.xlsx'
# The map generated during the extraction phase
MAP_FILE = 'paths_map.json'
# The English source (used as a structural template)
ORIGINAL_JSON = '../app/js/locales/en/learningPathways_en.json'
# The final translated output file
OUTPUT_JSON = 'learningPathways_translated.json'

def unprotect(text):
    """
    Strips the protection tags and cleans up any artifacts 
    introduced by the translation engine.
    """
    if pd.isna(text): return ""
    text = str(text)
    # Remove the protection spans
    text = re.sub(r'<span class="notranslate">(.*?)</span>', r'\1', text)
    # Clean up artifacts like <span class = "notranslate">
    return text.replace('<span class = "notranslate">', '').replace('</span>', '')

def set_by_path(data, path, value):
    """
    Navigates a nested JSON object/list structure using a string 
    path (e.g., 'categories[0].pathways[1].description') and sets the value.
    Filters out empty segments caused by the split operation.
    """
    # Fix: Filter out empty strings created by the split
    parts = [p for p in path.replace('[', '.[').split('.') if p]
    
    current = data
    for part in parts[:-1]:
        if part.startswith('['):
            current = current[int(part[1:-1])]
        else:
            current = current[part]
    
    last = parts[-1]
    if last.startswith('['):
        current[int(last[1:-1])] = value
    else:
        current[last] = value

def run():
    # Verify input files exist
    if not os.path.exists(INPUT_XLSX):
        print(f"❌ Error: {INPUT_XLSX} not found.")
        return
    if not os.path.exists(MAP_FILE):
        print(f"❌ Error: {MAP_FILE} not found.")
        return

    print(f"🔄 Processing {INPUT_XLSX}...")

    # 1. Load the original English structure
    try:
        with open(ORIGINAL_JSON, 'r', encoding='utf-8') as f:
            final_data = json.load(f)
    except Exception as e:
        print(f"❌ Error loading original JSON: {e}")
        return

    # 2. Load the translated Excel data
    try:
        df = pd.read_excel(INPUT_XLSX)
        # Use column index 1 to ignore translated headers
        translated_texts = df.iloc[:, 1].apply(unprotect).tolist()
    except Exception as e:
        print(f"❌ Error reading Excel file: {e}")
        return

    # 3. Load the Mapping instructions
    try:
        with open(MAP_FILE, 'r', encoding='utf-8') as f:
            mapping = json.load(f)
    except Exception as e:
        print(f"❌ Error loading map file: {e}")
        return

    # 4. Map the translations back to their original JSON paths
    for i, entry in enumerate(mapping):
        if i < len(translated_texts):
            # FIX: Handles both 'Path' and 'path'
            path_val = entry.get('Path') or entry.get('path')
            
            if path_val:
                set_by_path(final_data, path_val, translated_texts[i])
            else:
                print(f"⚠️ Warning: Entry {i} in map file is missing a valid path key.")

    # 5. Save the finished translated JSON
    json_saved = False
    try:
        with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
            json.dump(final_data, f, indent=2, ensure_ascii=False)
        print(f"✅ Success! Created {OUTPUT_JSON}")
        json_saved = True
    except Exception as e:
        print(f"❌ Failed to save JSON: {e}")

    # 6. CLEANUP: Delete the translated Excel file on success
    if json_saved:
        try:
            os.remove(INPUT_XLSX)
            print(f"🗑️  Cleaned up: {INPUT_XLSX} has been deleted.")
        except OSError as e:
            print(f"⚠️  Note: Could not delete {INPUT_XLSX}: {e}")

if __name__ == "__main__":
    run()