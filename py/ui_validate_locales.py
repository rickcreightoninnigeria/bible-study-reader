import json
import os
import re
from collections import OrderedDict

# --- CONFIGURATION ---
BASE_DIR = "." 
SOURCE_LANG = "en"
SOURCE_FILE_NAME = f"ui_{SOURCE_LANG}.json"
SOURCE_PATH = os.path.join(BASE_DIR, SOURCE_LANG, SOURCE_FILE_NAME)

# This regex looks for the opening '{',  then captures the first word (the ID),
# then ignores everything else until the LAST closing '}' in that sequence.
# So it matches everything between { and }, handling the complex plural logic
VAR_REGEX = re.compile(r"\{([a-zA-Z0-9_.-]+)(?:[^{}]|\{[^{}]*\})*\}")
HTML_TAG_REGEX = re.compile(r"<(/?[a-z1-6]+).*?>")

def get_placeholder_ids(text):
    if not isinstance(text, str): return set()
    matches = VAR_REGEX.findall(text)
    return set(m for m in matches if m)

def validate_html(text):
    if not isinstance(text, str): return True
    tags = HTML_TAG_REGEX.findall(text)
    stack = []
    for tag in tags:
        if tag.startswith('/'):
            if not stack or stack[-1] != tag[1:]: return False
            stack.pop()
        else:
            if tag not in ['br', 'img', 'hr']: stack.append(tag)
    return len(stack) == 0

def validate_translations():
    if not os.path.exists(SOURCE_PATH):
        print(f"❌ Error: Source file not found at {SOURCE_PATH}")
        return

    fatal_errors = []

    try:
        with open(SOURCE_PATH, 'r', encoding='utf-8') as f:
            source_data = json.load(f, object_pairs_hook=OrderedDict)
    except json.JSONDecodeError as e:
        print(f"🚨 CRITICAL: Source English file is invalid JSON! {e}")
        return

    source_keys = set(source_data.keys())
    
    for lang in os.listdir(BASE_DIR):
        lang_path = os.path.join(BASE_DIR, lang)
        if lang == SOURCE_LANG or not os.path.isdir(lang_path):
            continue
        
        target_file = f"ui_{lang}.json"
        target_path = os.path.join(lang_path, target_file)
        if not os.path.exists(target_path): continue

        print(f"\n--- Checking Language: {lang.upper()} ---")
        issues_found = False
        
        try:
            with open(target_path, 'r', encoding='utf-8') as f:
                target_data = json.load(f, object_pairs_hook=OrderedDict)
        except json.JSONDecodeError as e:
            error_msg = f"❌ {lang.upper()}: Invalid JSON syntax. {e}"
            print(error_msg)
            fatal_errors.append(error_msg)
            continue

        target_keys = set(target_data.keys())

        # 1. Missing keys (in EN but not in Target)
        # We ignore ___ headers because the Sync script should handle them, 
        # but you likely want to know if real UI text is missing.
        missing = sorted(list(source_keys - target_keys))
        if missing: 
            print(f"⚠️  Missing keys ({len(missing)}):")
            for k in missing:
                print(f"    - {k}")
            issues_found = True
        
        # 2. Orphaned keys (in Target but no longer in EN)
        extra = sorted(list(target_keys - source_keys))
        if extra: 
            print(f"🗑️  Orphaned keys ({len(extra)}):")
            for k in extra:
                print(f"    - {k}")
            issues_found = True

        # 3. Content validation
        for key in source_keys:
            if key in target_data and not key.startswith("___"):
                source_vars = get_placeholder_ids(source_data[key])
                target_vars = get_placeholder_ids(target_data[key])
                
                if source_vars != target_vars:
                    print(f"❌ Var mismatch in [{key}]")
                    print(f"   Expected: {source_vars}")
                    print(f"   Found:    {target_vars}")
                    issues_found = True
                
                if not validate_html(target_data[key]):
                    print(f"❌ Broken HTML in [{key}]")
                    issues_found = True

        if not issues_found:
            print("✅ No problems detected")

    print("\n" + "="*40)
    if fatal_errors:
        print(f"🚩 FOUND {len(fatal_errors)} JSON SYNTAX ERRORS (See above)")
    else:
        print("✅ All JSON files are syntactically valid.")
    print("="*40)

if __name__ == "__main__":
    validate_translations()
