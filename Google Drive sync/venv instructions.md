## venv: What and why?
Modern Linux distributions (like Ubuntu 23.04+, Debian 12+, and recent Fedora/Raspbian) have implemented **PEP 668**. This policy prevents `pip` from installing packages into the system-wide Python directory to avoid breaking the operating system's own tools.

Since you are building a toolset for your Bible study project, the best way to handle this is to create a **Virtual Environment**. This creates a private "bubble" where you can install the Google API libraries without affecting the rest of your computer.

### The Solution: 3 Simple Steps

#### 1. Create the Virtual Environment
Navigate to your project folder (where your scripts are) and run:
```bash
python3 -m venv venv
```
*This creates a folder named `venv` that contains its own private copy of Python and pip.*

#### 2. "Activate" the Environment
You need to tell your terminal to use this private bubble:
```bash
source venv/bin/activate
```
*You will notice `(venv)` appear at the start of your command prompt. This means anything you install now stays inside this folder.*

#### 3. Install the Libraries
Now the `pip` command will work perfectly:
```bash
pip install --upgrade google-api-python-client google-auth-httplib2 google-auth-oauthlib
```

---

### How to run your scripts from now on

Whenever you want to run your sync script, you have two choices:

**Option A (The "Manual" way):**
1. Open terminal.
2. `source venv/bin/activate`
3. `python sync_to_drive.py`

**Option B (The "Shortcut" way):**
You don't actually have to "activate" it if you point directly to the python inside the venv folder:
```bash
./venv/bin/python sync_to_drive.py
```

### Why this is actually better for you
By using this virtual environment, you keep all your project dependencies (the Google libraries) contained. If you ever move this project to a different computer, you just copy your scripts, create a new `venv`, and run the `pip install` command again.

**Pro Tip:** Add `venv/` to a `.gitignore` file if you are using Git, as you don't need to upload the environment itself—only your scripts and the `credentials.json` file.

---
## Moving venv

Moving a virtual environment (`venv`) usually breaks it, even if you update your alias. This is a common "gotcha" with Python virtual environments. When a `venv` is created, it hardcodes the **absolute paths** to the Python interpreter and the library folders inside several of its internal configuration files.

### Why it breaks
If you move the folder, the scripts inside `venv/bin/` will still try to look for Python and your installed libraries at the **old location**. You will likely see errors like `No such file or directory` or `ModuleNotFoundError` because the internal "pointers" are now pointing to a path that doesn't exist.

### The Correct Way to "Move" a Venv
The standard practice in the Python world is: **Don't move it; delete and recreate it.**

Since your libraries (the Google API tools) are not stored in the script but in the `venv` folder, follow these steps at the new location:

1.  **Move your scripts** (and your `credentials.json` and `token.json`) to the new folder.
2.  **Delete the old `venv` folder** (it's just a collection of downloaded files, nothing you wrote).
3.  **Create a new one** in the new location:
    ```bash
    python3 -m venv venv
    ```
4.  **Re-install the libraries**:
    ```bash
    source venv/bin/activate
    pip install --upgrade google-api-python-client google-auth-httplib2 google-auth-oauthlib
    ```
5.  **Update your alias** in `~.bashrc` to point to the new path.

### Can I make the script "subfolder-aware"?
Since we are talking about moving things, if you want your `sync_to_drive.py` to automatically find `.estudy` files in all subfolders from wherever it is sitting, you should definitely use the **Recursive** version of the `run_sync` function I mentioned previously.

That version uses `os.walk('.')`, which looks at the "Current Working Directory" (where the script is launched from) and dives into every subfolder it finds there.

---

**One quick tip:** If you find yourself moving projects often, you might look into **`pipx`** in the future. It manages these "bubbles" for you automatically so you don't have to worry about paths, but for now, the "delete and recreate" method is the safest way to ensure your Google Drive sync doesn't fail.

How many different locations are you planning to run these scripts from?
