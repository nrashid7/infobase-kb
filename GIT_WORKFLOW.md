# Git Workflow

This repository uses **PortableGit** as the single source of truth for all Git operations.

## Git Installation

| Component | Path |
|-----------|------|
| Git executable | `C:\Git\PortableGit\bin\git.exe` |
| Git commands | `C:\Git\PortableGit\cmd` |

> **Important:** Do NOT install Git for Windows or GitHub Desktop. PortableGit must be the only Git installation on the system.

---

## Configuration

### PATH Setup (Required)

PortableGit must be **first** in your PATH so that `git` resolves correctly everywhere.

#### Option 1: System Environment Variable (Recommended)

Add to your Windows System PATH (requires admin):

```
C:\Git\PortableGit\bin
C:\Git\PortableGit\cmd
```

These entries must appear **before** any other Git paths.

#### Option 2: PowerShell Profile (User-level)

Add to your PowerShell profile (`$PROFILE`):

```powershell
# PortableGit - must be first in PATH
$env:PATH = "C:\Git\PortableGit\bin;C:\Git\PortableGit\cmd;$env:PATH"
```

#### Option 3: Run Setup Script

Execute the included setup script:

```powershell
.\scripts\setup_portablegit.ps1
```

---

## Cursor IDE Configuration

Cursor is pre-configured via `.vscode/settings.json`:

- **git.path**: Points to PortableGit executable
- **terminal.integrated.env.windows**: Injects PortableGit into terminal PATH

No additional configuration is required.

---

## Usage

### Standard Commands

Always use `git` without the full path:

```powershell
git status
git add .
git commit -m "Your message"
git push
git pull
```

### Fallback (Debugging Only)

If `git` doesn't resolve correctly, use the full path for debugging:

```powershell
C:\Git\PortableGit\bin\git.exe --version
```

This should only be needed to diagnose PATH issues.

---

## Verification

Run these commands to confirm PortableGit is configured correctly:

### 1. Check PATH Resolution

```powershell
where.exe git
```

**Expected output:**
```
C:\Git\PortableGit\bin\git.exe
```

If multiple paths appear, `C:\Git\PortableGit\bin\git.exe` must be **first**.

### 2. Check Git Version

```powershell
git --version
```

**Expected output:**
```
git version 2.x.x.windows.x
```

### 3. Verify Cursor Terminal

1. Open Cursor's integrated terminal (`` Ctrl+` ``)
2. Run `where.exe git`
3. Confirm it shows `C:\Git\PortableGit\bin\git.exe` first

### 4. Test Git Operations

```powershell
git status
git log --oneline -5
```

Both should work without errors.

---

## Troubleshooting

### `git` command not found

1. Verify PortableGit exists at `C:\Git\PortableGit\bin\git.exe`
2. Check your PATH: `$env:PATH -split ';' | Select-String -Pattern 'Git'`
3. Restart your terminal/Cursor after PATH changes

### Wrong Git version being used

1. Run `where.exe git` to see all Git installations
2. Remove or rename conflicting Git installations
3. Ensure PortableGit paths are first in PATH

### Cursor not using PortableGit

1. Verify `.vscode/settings.json` exists and contains `"git.path"`
2. Reload Cursor window: `Ctrl+Shift+P` → "Developer: Reload Window"
3. Check terminal PATH in Cursor: `$env:PATH -split ';' | Select-Object -First 5`

---

## Repository Scripts

Scripts in this repository use `git` (not the full path) and assume PortableGit is correctly configured in PATH.

If you must reference the full path in a script (for portability), use:

```powershell
$gitPath = "C:\Git\PortableGit\bin\git.exe"
```

---

## Summary

| Item | Value |
|------|-------|
| Git Binary | `C:\Git\PortableGit\bin\git.exe` |
| Required in PATH | `C:\Git\PortableGit\bin` (first) |
| Cursor Config | `.vscode/settings.json` |
| Command to use | `git` |
| Full path usage | Debugging only |

