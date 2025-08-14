# ChromeDump

<img width="1150" height="590" alt="image" src="https://github.com/user-attachments/assets/d69ef7df-9fcb-415f-b5f8-9b748945a2a3" />


A Node.js toolkit with two tools for Chrome tab management:
- **ChromeDump**: Extracts all Chrome tabs, reads content, generates AI summaries, and exports to markdown
- **ChromeKeep**: Compares open tabs against a markdown file and lets you close tabs not saved in markdown

created in Claude Code. note that Claude Code's bash tool has a 10min timeout and so this process will prematurely exit if use inside claude code for >100 tabs by default. just tell it to use bash tool but set for a 30 minute timeout instead of its default 10.

## Features

### ChromeDump
- 🔍 **Extract Chrome tabs** from all windows using macOS automation
- ⚡ **Fast mode** (`--fast` flag) - instant tab dump without API calls or processing
- ⚡ **Fast initial dump** - instant markdown with all tab titles and URLs (even in full mode)
- 📖 **Read tab content** via Jina.ai (first 30k words per tab)
- 🤖 **AI summaries** using OpenAI GPT-4o-mini
- ⚡ **Sequential processing** with rate limiting and error handling
- 📊 **Real-time progress** tracking with counters, percentages, and elapsed time
- 📝 **Dense markdown export** with clickable links and summaries

### ChromeKeep
- 📄 **Parse URLs** from markdown files (both `[text](url)` and bare URLs)
- 🔍 **Compare** open tabs against saved URLs in markdown
- ✅ **Multiselect UI** to review tabs not in markdown (all pre-selected)
- 🗑️ **Safe tab closing** with confirmation prompt and batch processing
- 🎯 **Tab preservation** - keep only tabs you've saved in markdown
- ⚡ **Handles large batches** - processes tabs in batches of 20 to avoid command line limits

## Installation

```bash
npm install
```

## Environment Variables

### Setup Options

**Option 1: Use .env file (Recommended)**
```bash
# Copy the example file
cp .env.example .env

# Edit .env file with your API keys
nano .env
```

**Option 2: Export manually**
```bash
export OPENAI_API_KEY=sk-proj-your-openai-key-here
```

### Required
- `OPENAI_API_KEY`: Your OpenAI API key for generating summaries (not needed for `--fast` mode)

## Rate Limits & Performance

**Rate Limits & Optimizations:**
- Jina.ai free tier: 1 concurrent, 20 RPM (1s delays only on retries)
- OpenAI Tier 1: 5 concurrent, 500 RPM
- Smart filtering: Skip 30-50% of tabs (domains, file types, short content)
- Reduced processing: 30k words max per tab
- Real-time progress: Counters, percentages, and elapsed time tracking

### Estimated Processing Time (200 tabs example)
- **Step 1**: Extract tabs (~10 seconds)
- **Step 1.5**: ⚡ Fast dump creation (~1 second) - **INSTANT ACCESS TO ALL TABS**
- **Step 2**: Read content (~10 minutes)
  - ~50% tabs skipped (domains, file types, short content)
  - ~100 remaining tabs × 1 concurrent × ~3.5s Jina.ai response time
- **Step 3**: Generate summaries (~2 minutes) 
  - ~80 tabs with >200 words ÷ 5 concurrent × ~5.5s OpenAI response time
- **Step 4**: Generate full export (~2 seconds)

**Total: ~12-15 minutes for 200 tabs (but you get the fast dump in ~11 seconds!)**

## Usage

### ChromeDump
Export all tabs with AI summaries:
```bash
# Basic usage (requires OPENAI_API_KEY)
npm run dump

# Or set environment variable inline
OPENAI_API_KEY=your_key npm run dump

# Fast mode - instant tab dump without content/AI processing
npm run fast

# Or directly with flag
node chromedump.js --fast
```

### ChromeKeep
Compare and clean up tabs against a markdown file:
```bash
# Using npm script with specific file
npm run keep your-saved-tabs.md

# Or use the latest created .md file automatically
npm run keep-latest

# Or directly
node chromekeep.js your-saved-tabs.md
```

**ChromeKeep Workflow:**
1. Reads URLs from your markdown file
2. Gets all open Chrome tabs
3. Identifies tabs not saved in markdown
4. Shows multiselect list (all pre-selected)
5. Confirms before closing selected tabs

**Typical Combined Workflow:**
```bash
# 1. Export your current tabs
npm run fast          # or npm run dump for full export

# 2. Clean up tabs based on what you just exported
npm run keep-latest
```

## Output Format

### ChromeDump
Generates **two timestamped markdown files**:

1. **Fast Dump** (`open-tabs-fast-TIMESTAMP.md`) - Instant access to all tabs
2. **Full Export** (`open-tabs-TIMESTAMP.md`) - Complete with AI summaries

**Fast Dump Format:**
```markdown
# Chrome Tabs Fast Dump - 8/14/2025, 11:45:00 AM

**192 tabs across 21 windows**

## Window 1 (11 tabs)

- [Tab Title](https://example.com) (domain.com)
- [Another Tab](https://example2.com) (domain2.com)

## Window 2 (5 tabs)

- [More Tabs](https://example3.com) (domain3.com)
```

**Full Export Format:**
```markdown
# Chrome Tabs Export - 8/14/2025, 11:45:00 AM

**192 tabs across 21 windows**
- 📖 Content read: 145 tabs  
- 🤖 Summaries generated: 145 tabs

- **Window 1** (11 tabs)
    - [Tab Title](https://example.com) (domain.com) - AI-generated summary here
    - [Another Tab](https://example2.com) (domain2.com) - Another summary
    
- **Window 2** (5 tabs)
    - [More Tabs](https://example3.com) (domain3.com) - More summaries
```

### ChromeKeep
Provides interactive CLI output and closes selected tabs - no file output.

## Requirements

- macOS (uses AppleScript for Chrome automation)
- Google Chrome running
- Node.js
- OpenAI API key (ChromeDump full mode only, not needed for `--fast` mode)

## Permissions

You may need to grant permission for Terminal/iTerm to control Chrome:
- System Preferences → Security & Privacy → Privacy → Automation
- Allow your terminal app to control Google Chrome

## Error Handling

The tool includes robust error handling:
- ✅ Automatic retries with exponential backoff
- ✅ Rate limiting to respect API limits  
- ✅ Fallback for failed content reads
- ✅ Detailed progress logging
- ✅ Graceful handling of inaccessible tabs
- ✅ **Batch processing** for large tab counts (ChromeKeep processes 20 tabs at a time to avoid AppleScript command line limits)

## Example Output

See the generated `.md` files for examples of the rich markdown output with AI summaries.
