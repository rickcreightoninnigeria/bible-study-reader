import json
import pandas as pd
import os
import re

# --- CONFIGURATION ---
# Source file location
INPUT_PATH = '../app/js/locales/en/ui_en.json'
# Output file for Google Translate
OUTPUT_XLSX = 'ui_translate.xlsx'

def protect_placeholders(text):
    """
    Wraps {variables} in HTML span tags.
    Google Translate's Document engine respects 'notranslate' classes, 
    preventing it from translating code variables like {count}.
    """
    if not isinstance(text, str): return text
    return re.sub(r'(\{[a-zA-Z0-9_]+\})', r'<span class="notranslate">\1</span>', text)

def run_extraction():
    print(f"🚀 Starting extraction from {INPUT_PATH}...")

    if not os.path.exists(INPUT_PATH):
        print(f"❌ Error: Could not find {INPUT_PATH}")
        return

    # 1. Load the English UI JSON
    try:
        with open(INPUT_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"❌ Error loading JSON: {e}")
        return

    rows = []
    for key, value in data.items():
        # A. Skip technical comments or logical section headers starting with ___
        if key.startswith('___'):
            continue
        
        # B. Skip empty strings to keep the translation file lean
        if not value or value.strip() == "":
            continue

        # C. Protect variables and prepare row data for the DataFrame
        protected_text = protect_placeholders(value)
        rows.append({'Key': key, 'Text': protected_text})

    # 2. Save to XLSX using Pandas
    if rows:
        df = pd.DataFrame(rows)
        df.to_excel(OUTPUT_XLSX, index=False)
        print(f"✅ Success! {len(rows)} strings extracted to {OUTPUT_XLSX}")
        print("👉 ACTION: Upload this file to the 'Documents' tab in Google Translate.")
    else:
        print("⚠️  No translatable strings found.")

if __name__ == "__main__":
    run_extraction()