import json
import pandas as pd
import re
import os

# --- CONFIGURATION ---
# The file you download back from Google Translate
INPUT_XLSX = '/home/rick/Downloads/ui_translate.xlsx'
# The final translated JSON result
OUTPUT_JSON = 'ui_translated.json'

def unprotect_placeholders(text):
    """
    Removes the protection tags and cleans up common 
    formatting artifacts introduced by Machine Translation.
    """
    if pd.isna(text): return ""
    text = str(text)
    # Restore placeholders by stripping the protection span tags
    text = re.sub(r'<span class="notranslate">(.*?)</span>', r'\1', text)
    # Clean up artifacts like <span class = "notranslate">
    return text.replace('<span class = "notranslate">', '').replace('</span>', '')

def run_insertion():
    # Verify the input file exists before starting
    if not os.path.exists(INPUT_XLSX):
        print(f"❌ Error: {INPUT_XLSX} not found.")
        return

    print(f"🔄 Reconstructing JSON from {INPUT_XLSX}...")

    translated_data = {}

    # 1. Load the translated Excel data
    try:
        df = pd.read_excel(INPUT_XLSX)
        
        # Iterate through rows to build the dictionary. 
        # Column index 0 is the Key, Column index 1 is the translated Text.
        for _, row in df.iterrows():
            key = str(row.iloc[0])
            content = row.iloc[1]
            
            # Clean up the text and restore placeholders
            clean_text = unprotect_placeholders(content)
            translated_data[key] = clean_text
            
    except Exception as e:
        print(f"❌ Error reading Excel file: {e}")
        return

    # 2. Save the finished JSON
    json_saved = False
    try:
        with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
            # ensure_ascii=False handles non-Latin scripts (Amharic, Greek, etc.) correctly
            json.dump(translated_data, f, indent=2, ensure_ascii=False)
        print(f"✅ Success! Created {OUTPUT_JSON}")
        json_saved = True
    except Exception as e:
        print(f"❌ Failed to save JSON: {e}")

    # 3. CLEANUP: Delete the translated XLSX file only if the JSON was successfully saved
    if json_saved:
        try:
            os.remove(INPUT_XLSX)
            print(f"🗑️  Cleaned up: {INPUT_XLSX} has been deleted.")
        except OSError as e:
            print(f"⚠️  Note: Could not delete {INPUT_XLSX} (it may be open in Excel): {e}")

if __name__ == "__main__":
    run_insertion()