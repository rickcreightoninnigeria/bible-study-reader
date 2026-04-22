import json
import os
import re

# --- CONFIGURATION ---
BASE_DIR = "." 
SOURCE_FILE = "./en/libraryShelvesStructure_en.json"
# Regex to find {variable_name}
VAR_REGEX = re.compile(r"\{([a-zA-Z0-9_.-]+)\}")
# Regex to find HTML tags
HTML_TAG_REGEX = re.compile(r"<(/?[a-z1-6]+).*?>")

def get_placeholders(text):
    if not isinstance(text, str): return set()
    return set(VAR_REGEX.findall(text))

def validate_html(text):
    if not isinstance(text, str): return True
    tags = HTML_TAG_REGEX.findall(text)
    stack = []
    for tag in tags:
        if tag.startswith('/'):
            if not stack or stack[-1] != tag[1:]: return False
            stack.pop()
        else:
            # Ignore self-closing tags
            if tag not in ['br', 'img', 'hr']: stack.append(tag)
    return len(stack) == 0

def validate_file(file_path):
    issues = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        return [f"❌ CRITICAL: JSON Syntax Error: {e}"]

    # We iterate through the structure. Since it's nested, 
    # we use a helper to find all strings in objects.
    def check_recursive(obj, path="root"):
        if isinstance(obj, dict):
            for k, v in obj.items():
                current_path = f"{path}.{k}"
                if isinstance(v, str):
                    # 1. Check HTML
                    if not validate_html(v):
                        issues.append(f"❌ Broken HTML at [{current_path}]: {v[:30]}...")
                    # 2. Check for suspicious bracket usage (potential broken placeholders)
                    if '{' in v or '}' in v:
                        if v.count('{') != v.count('}'):
                            issues.append(f"⚠️  Mismatched curly braces at [{current_path}]")
                else:
                    check_recursive(v, current_path)
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                check_recursive(item, f"{path}[{i}]")

    check_recursive(data)
    return issues

def run_validation():
    print("🚀 Starting Shelves Structure Validation...")
    print("="*40)
    
    found_any_issue = False
    
    # Scan current directory for translated shelf files
    for file_name in os.listdir('.'):
        if file_name.startswith('libraryShelvesStructure_') and file_name.endswith('.json'):
            print(f"🔍 Checking: {file_name}")
            errors = validate_file(file_name)
            
            if not errors:
                print("   ✅ Perfect.")
            else:
                found_any_issue = True
                for err in errors:
                    print(f"   {err}")
            print("-" * 20)

    if not found_any_issue:
        print("\n✨ All shelf files passed technical validation!")

if __name__ == "__main__":
    run_validation()