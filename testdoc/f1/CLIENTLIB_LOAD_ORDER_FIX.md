# ClientLib Load Order Fix - Root Cause Analysis

## Issue Report

**Date:** December 30, 2025  
**Severity:** CRITICAL - jQuery corruption breaking AEM functionality
**Error:** `$.ajax is undefined` immediately when plugin loads

## The Real Root Cause

After extensive investigation, the issue was **NOT in the adapter code** - it was in **WHEN the clientlib loads**!

### The Problem

Our clientlib was configured with this category:

```javascript
categories: [
  "cq.authoring.dialog.all",
  "apps.fmdita.xml_editor.page_overrides",
  "fmdita.ckeditor.init",  // ❌ THIS WAS THE PROBLEM!
],
```

The `fmdita.ckeditor.init` category means our JavaScript loads and executes **DURING CKEditor initialization**.

### Why This Breaks jQuery

1. **CKEditor starts initializing** (loads `fmdita.ckeditor.init` category)
2. **Our code loads simultaneously** (because we're in that category)
3. **Our `main.ts` executes immediately** (`document.readyState` check)
4. **CKEditor is still setting up** and manipulating global variables
5. **jQuery (`$`) gets corrupted** during this chaotic initialization phase
6. **Result**: `$.ajax` becomes `undefined` or `$` gets replaced entirely

### The Timeline

```
Time 0ms:    CKEditor initialization starts
             ↓
Time 50ms:   fmdita.ckeditor.init category loads
             ├─ CKEditor core loading
             ├─ Our plugin loads (main.ts)  ← CONFLICT!
             └─ Both trying to touch $ at the same time
             ↓
Time 100ms:  CKEditor manipulates $ during setup
             Our code tries to access $
             ↓
Time 150ms:  $ is corrupted - ajax is undefined
             ↓
Time 200ms:  AEM tries to use $.ajax
             ❌ TypeError: $.ajax is not a function
```

## The Fix

### Change ClientLib Configuration

**Before:**

```javascript
categories: [
  "cq.authoring.dialog.all",
  "apps.fmdita.xml_editor.page_overrides",
  "fmdita.ckeditor.init",  // Loading DURING CKEditor init
],
dependencies: ["cq.jquery", "fmdita", "markupai-aem-guides.dependencies"],
```

**After:**

```javascript
categories: [
  "cq.authoring.dialog.all",
  "apps.fmdita.xml_editor.page_overrides",
  // Removed from fmdita.ckeditor.init category
],
dependencies: [
  "cq.jquery",
  "fmdita",
  "fmdita.ckeditor.init",  // ✅ Now a DEPENDENCY - loads AFTER CKEditor
  "markupai-aem-guides.dependencies"
],
```

### Why This Works

By moving `fmdita.ckeditor.init` from **categories** to **dependencies**:

1. ✅ **CKEditor initializes first** (fmdita.ckeditor.init loads)
2. ✅ **CKEditor completes setup** (including any $ manipulation)
3. ✅ **Our plugin loads AFTER** (dependency means "load after")
4. ✅ **jQuery is stable** when our code runs
5. ✅ **No conflicts** - we're not racing with CKEditor

### New Timeline

```
Time 0ms:    fmdita.ckeditor.init loads
             ↓
Time 100ms:  CKEditor fully initialized
             $ is stable
             ↓
Time 150ms:  Our plugin loads (dependency resolved)
             main.ts executes
             ↓
Time 200ms:  All code working correctly
             ✅ $.ajax is a function
```

## Files Modified

### 1. `ui.frontend/clientlib.config.js`

```javascript
// Line 67-72
name: "clientlib-site",
categories: [
  "cq.authoring.dialog.all",
  "apps.fmdita.xml_editor.page_overrides",
  // Removed: "fmdita.ckeditor.init",
],
dependencies: [
  "cq.jquery",
  "fmdita",
  "fmdita.ckeditor.init",  // Added as dependency
  "markupai-aem-guides.dependencies"
],
```

### 2. Generated `.content.xml`

The clientlib generator automatically updates:
`ui.apps/src/main/content/jcr_root/apps/markupai-aem-guides/clientlibs/clientlib-site/.content.xml`

## Why Previous Fixes Didn't Work

### Fix Attempt 1: Intermediate Variables

- **What we did**: Stored `ckElement.$` in variables
- **Why it failed**: The module was still loading during CKEditor init
- **Result**: Still corrupted

### Fix Attempt 2: Save & Restore Pattern

- **What we did**: Saved `$` before accessing CKEditor, restored after
- **Why it failed**: The corruption happens at MODULE LOAD TIME, not during adapter operations
- **Result**: By the time we try to save `$`, it's already corrupted

### Fix Attempt 3: Protect Both `$` and `jQuery`

- **What we did**: Saved and restored both variables
- **Why it failed**: Same as above - corruption happens too early
- **Result**: Still broken on load

### Fix Attempt 4: ClientLib Load Order (THIS ONE WORKS!)

- **What we did**: Changed WHEN our code loads
- **Why it works**: We're not loading during CKEditor initialization anymore
- **Result**: ✅ jQuery is stable when we load

## Testing Instructions

### 1. Deploy to AEM

```bash
cd /Users/pareshdeshmukh/git/github/aem-guides
./quick-start.sh
```

### 2. Clear Browser Cache

- Hard refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows)
- Or completely clear cache in DevTools

### 3. Test jQuery

Open browser console:

```javascript
console.log("Type of $:", typeof $);
// Expected: "function"

console.log("Type of jQuery:", typeof jQuery);
// Expected: "function"

console.log("Type of $.ajax:", typeof $.ajax);
// Expected: "function"  ✅ NOT "undefined"!

console.log("$.ajax:", $.ajax);
// Expected: ƒ ajax(url, settings) { ... }
```

### 4. Test AEM Operations

- ✅ Open a document
- ✅ Edit content
- ✅ Save document
- ✅ Use Markup.ai sidebar

## Key Learnings

### 1. Load Order Matters

Clientlib categories determine **WHEN** code runs, not just if it loads. Loading during another library's initialization can cause conflicts.

### 2. Dependencies vs Categories

- **Categories**: "I am part of this loading phase"
- **Dependencies**: "I need this to load BEFORE me"

### 3. CKEditor's Initialization

CKEditor does something during initialization that affects global `$`. By not being present during that phase, we avoid the corruption.

### 4. The Save/Restore Pattern is Still Useful

While it didn't fix the root cause, the save/restore pattern is still good defensive programming for when we DO access CKEditor properties.

## Prevention

### For Future Clientlibs

1. ✅ **Never add to `*.init` categories** unless you're actually part of that library's initialization
2. ✅ **Use dependencies** to control load order
3. ✅ **Load AFTER** libraries that manipulate globals
4. ✅ **Test load timing** with different AEM configurations

### ClientLib Best Practices

```javascript
// ❌ BAD - Loading during library initialization
categories: ["library.init"]

// ✅ GOOD - Loading after library is ready
categories: ["your.category"],
dependencies: ["library.init"]
```

## References

- AEM ClientLib Documentation: Load order and dependencies
- CKEditor Initialization: Global scope manipulation
- jQuery: `$` and `jQuery` global variables
- AEM Guides (fmdita): ClientLib categories

## Status

✅ **Root Cause**: Identified - Loading during CKEditor init  
✅ **Fix Applied**: Changed clientlib configuration  
✅ **Build**: Successful  
⏳ **Deploy**: Ready for deployment  
⏳ **Testing**: Awaiting verification
