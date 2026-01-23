# Debugging Guide for Select/Replace Content

## Issue: "Content has been modified" Error

### Problem

When calling `selectContent()` or `replaceContent()`, you might see:

```
Error: Content has been modified. Cannot select the specified text.
```

### Root Cause

The diff-based alignment couldn't find a match, which happens when:

1. **No baseline content**: `lastContentChecked` is null/empty
2. **Format mismatch**: Comparing HTML vs extracted text
3. **Content actually changed**: User edited content since check
4. **Diff timeout**: Content is too different (>3.5s to compute)

---

## Fix Applied ✅

### 1. Store TEXT Version (Not Just HTML)

**Before**: Only stored HTML content

```typescript
this.lastContentChecked = content; // HTML string
```

**After**: Store extracted text version

```typescript
const textMapping = this.getTextDomMapping();
this.lastContentChecked = textMapping.text; // Extracted text
this.lastContentCheckedHTML = content; // HTML for reference
```

### 2. Use TEXT Format for Comparison

**Before**: Used 'HTML' format

```typescript
lookupMatches(this.lastContentChecked, textMapping.text, [match], "HTML");
```

**After**: Use 'TEXT' format since both are text

```typescript
lookupMatches(baselineContent, textMapping.text, [match], "TEXT");
```

### 3. Fallback to Current Content

**Before**: Failed if no lastContentChecked

```typescript
lookupMatches(this.lastContentChecked || '', ...)
```

**After**: Use current content as baseline if none stored

```typescript
const baselineContent = this.lastContentChecked || textMapping.text;
lookupMatches(baselineContent, ...)
```

### 4. Added Debug Logging

Now logs at key points:

- Input parameters (original text, ranges)
- Content lengths (baseline vs current)
- Lookup results (match count, aligned ranges)
- Failure details (shows why match failed)

---

## Debugging Steps

### 1. Check Browser Console

Look for these debug messages:

```
[getContent] Stored content for tracking: {
  htmlLength: 5234,
  textLength: 3421
}

[selectEditorContent] Input: {
  original: "Lorem ipsum...",
  startIndex: 100,
  textLength: 3421,
  lastContentCheckedLength: 3421
}

[selectEditorContent] Lookup result: {
  alignedMatchesCount: 1,  // Should be > 0
  baselineLength: 3421,
  currentLength: 3450      // Different = content changed
}
```

### 2. Common Issues & Solutions

#### Issue: `alignedMatchesCount: 0`

**Cause**: Content doesn't match
**Check**: Compare `baselineLength` vs `currentLength`

- If very different → content was edited
- If same → might be character encoding issue

**Solution**:

- Call `getContent()` again to refresh baseline
- Or accept the content difference

#### Issue: `lastContentCheckedLength: 0`

**Cause**: `getContent()` was never called
**Solution**: Ensure `getContent()` is called before selection/replacement

```typescript
await adapter.getContent(); // Store baseline
await adapter.selectContent(text, index); // Now works
```

#### Issue: Match fails with identical lengths

**Cause**: Character encoding or whitespace differences
**Debug**:

```typescript
console.log("Baseline:", baselineContent.substring(0, 100));
console.log("Current:", textMapping.text.substring(0, 100));
```

### 3. Verify Content Extraction

Check if text extraction is working:

```typescript
const editor = getCKEditor();
const body = editor.document.getBody().$;
const mapping = extractTextDomMapping(body);
console.log("Extracted text length:", mapping.text.length);
console.log("DOM positions:", mapping.domPositions.length);
console.log("First 200 chars:", mapping.text.substring(0, 200));
```

### 4. Test Diff Performance

Check if diff is timing out:

```typescript
const startTime = Date.now();
const alignedMatches = lookupMatches(...);
const diffTime = (Date.now() - startTime) / 1000;
console.log('Diff took:', diffTime, 'seconds');
// Should be < 3.5 seconds
```

---

## Flow Diagram

```
User Check Flow:
1. User clicks "Check" button
   ↓
2. Plugin calls getContent()
   ↓
3. Store content:
   - lastContentCheckedHTML (HTML)
   - lastContentChecked (extracted text)
   ↓
4. Send to Markup.ai for checking
   ↓
5. Receive suggestions with startIndex

User Select/Replace Flow:
1. User clicks suggestion
   ↓
2. Plugin calls selectContent(original, startIndex)
   ↓
3. Get current text-DOM mapping
   ↓
4. Compare: lastContentChecked vs current text
   ↓
5. If match found:
   - Align positions (handle edits)
   - Create CKEditor range
   - Select in editor ✅
   ↓
6. If no match:
   - Log debug info
   - Throw error ❌
```

---

## Testing Scenarios

### Test 1: Basic Selection (Should Work ✅)

```typescript
// 1. Get content
await adapter.getContent();

// 2. Select something
await adapter.selectContent("Lorem ipsum", 0);
// Expected: Text is selected
```

### Test 2: Selection After Edit (Should Work ✅)

```typescript
// 1. Get content
await adapter.getContent();

// 2. User adds text at beginning
// "Hello Lorem ipsum..."

// 3. Select (diff will align position)
await adapter.selectContent("Lorem ipsum", 0);
// Expected: Text is selected at new position (6)
```

### Test 3: Selection of Deleted Text (Should Fail ❌)

```typescript
// 1. Get content with "Lorem ipsum"
await adapter.getContent();

// 2. User deletes "Lorem ipsum"

// 3. Try to select deleted text
await adapter.selectContent("Lorem ipsum", 0);
// Expected: Error - content modified
```

### Test 4: Multiple Replacements

```typescript
// 1. Get content
await adapter.getContent();

// 2. Replace first occurrence
await adapter.replaceContent("old", "new", { start: 10 });
// lastContentChecked is updated ✅

// 3. Replace second occurrence (using updated baseline)
await adapter.replaceContent("old", "new", { start: 50 });
// Expected: Works with updated positions
```

---

## Configuration

### Timeout Setting

Current: 3.5 seconds (in `lookup/diff-based.ts`)

```typescript
const DIFF_TIMEOUT_SECONDS = 3.5;
```

To change:

1. Edit `DIFF_TIMEOUT_SECONDS` constant
2. Rebuild: `npm run prod`

### Logging Level

Current: Always logs debug info

To disable:

1. Wrap console.log in environment check:

```typescript
if (process.env.NODE_ENV === "development") {
  console.log("[selectEditorContent] ...");
}
```

---

## Error Messages

### For Users

```
"Content has been modified. Cannot select the specified text.
The text may have been edited since the check was performed."
```

**User Actions:**

1. Click "Check" again to refresh
2. Try selection again
3. If still fails, the text was significantly modified

### For Developers

Check console for detailed logs with:

- Exact text being searched
- Content lengths
- First 200 characters of baseline vs current
- Aligned match ranges

---

## Performance Notes

- Text-DOM mapping extraction: ~1-5ms (fast)
- Diff calculation: ~10-100ms (depends on content size)
- Timeout at 3.5s for very large/different content
- Range creation: ~1ms (fast)

For large documents (>100KB), consider:

- Chunking content
- Incremental diff updates
- Caching text-DOM mappings

---

## Next Steps

If issues persist:

1. **Check Content Type**: Ensure XML content is being handled correctly
2. **Verify CKEditor State**: Make sure editor is in WYSIWYG mode
3. **Test with Simple Content**: Try selecting a simple paragraph first
4. **Enable More Logging**: Add console.logs at each step
5. **Check Browser Console**: Look for JavaScript errors

## Support

For issues, check:

- Browser console for detailed error logs
- Network tab for API responses
- CKEditor console warnings
- This debugging guide

Happy debugging! 🐛🔍
