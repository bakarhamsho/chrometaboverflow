# ChromeTabOverflow - manage your chrome tab overload with markdown and AI

<img width="1150" height="590" alt="image" src="https://github.com/user-attachments/assets/d69ef7df-9fcb-415f-b5f8-9b748945a2a3" />


A Node.js toolkit with four tools for comprehensive Chrome tab management:
- **ChromeDump**: Extracts all Chrome tabs, reads content, generates AI summaries, and exports to markdown
- **ChromeKeep**: Compares open tabs against a markdown file and lets you close tabs NOT present in markdown
- **ChromeRecommend**: Analyzes tab patterns using AI and provides intelligent reorganization recommendations
- **ChromeReorg**: Automatically executes approved reorganization plans by moving tabs between windows

created in Claude Code. note that Claude Code's bash tool has a 10min timeout and so this process will prematurely exit if use inside claude code for >100 tabs by default. just tell it to use bash tool but set for a 30 minute timeout instead of its default 10.

## Features

### ChromeDump
- 🔍 **Extract Chrome tabs** from all windows using macOS automation
- ⚡ **Fast mode** (`--fast` flag) - instant tab dump without API calls or processing
- ⚡ **Fast initial dump** - instant markdown with all tab titles and URLs (even in full mode)
- 📖 **Read tab content** via Jina.ai (first 30k words per tab)
- 🤖 **AI summaries** using OpenAI GPT-5-nano
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

### ChromeRecommend
- 🤖 **AI-powered analysis** using GPT-5 with chain of thought reasoning
- 📊 **Pattern recognition** - identifies domains, topics, work contexts, and usage patterns
- 🏗️ **Smart grouping suggestions** - recommends logical window organizations
- 📋 **Structured recommendations** with specific actionable steps
- 📝 **Detailed reports** - generates comprehensive reorganization plans
- 🎯 **Productivity focus** - optimizes for workflow efficiency and context switching reduction

### ChromeReorg
- 🔄 **Automated execution** of approved reorganization plans using AppleScript
- 🪟 **Window management** - creates new windows and moves tabs between them
- 📋 **Plan parsing** - reads recommendations from ChromeRecommend output
- ✅ **Safe execution** - shows preview and requires confirmation before changes
- 🎯 **Precise control** - moves specific tabs by URL matching for accuracy
- 🔒 **Rollback support** - can undo changes if something goes wrong

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
- `OPENAI_API_KEY`: Your OpenAI API key for generating summaries (ChromeDump full mode) and reorganization recommendations (ChromeRecommend). Not needed for ChromeDump `--fast` mode, ChromeKeep, or ChromeReorg.

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
# Fast mode - instant tab dump without content/AI processing!!! try this first!
npm run fast

# fast dump + summarize usage (requires OPENAI_API_KEY in .env)
npm run dump

# Or set environment variable inline
OPENAI_API_KEY=your_key npm run dump

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

### ChromeRecommend
Analyze tab patterns and get AI reorganization recommendations:
```bash
# Analyze specific chromedump file (requires OPENAI_API_KEY)
npm run recommend open-tabs-fast-2025-08-14T20-33-43-477Z.md

# Or analyze the latest chromedump file automatically
npm run recommend-latest

# Or directly
node chromerecommend.js your-chromedump-file.md
```

### ChromeReorg
Execute approved reorganization plans automatically:
```bash
# Execute reorganization from recommendations file
npm run reorg chrome-organization-recommendations-2025-08-14T20-34-03-918Z.md

# Or directly
node chromereorg.js your-recommendations-file.md
```

**ChromeKeep Workflow:**
1. Reads URLs from your markdown file
2. Gets all open Chrome tabs
3. Identifies tabs not saved in markdown
4. Shows multiselect list (all pre-selected)
5. Confirms before closing selected tabs

**Complete Workflow:**
```bash
# 1. Export your current tabs
npm run fast          # or npm run dump for full export with AI summaries

# 2. Get AI reorganization recommendations  
npm run recommend-latest

# 3. Execute the reorganization (optional)
npm run reorg chrome-organization-recommendations-*.md

# 4. Clean up tabs based on what you exported (optional)
npm run keep-latest
```

**Quick Analysis Workflow:**
```bash
# Fast dump + immediate AI analysis
npm run fast && npm run recommend-latest
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

### ChromeRecommend
Generates **timestamped analysis report** (`chrome-organization-recommendations-TIMESTAMP.md`):

### ChromeReorg
Reads recommendations files and executes reorganization - no file output, modifies Chrome directly.

**Report Format:**
```markdown
# Chrome Tab Organization Recommendations
Generated: 8/14/2025, 8:34:03 PM
Source: open-tabs-fast-2025-08-14T20-33-43-477Z.md
Total tabs: 89 across 15 windows

## AI Analysis
[Chain of thought reasoning about current tab organization patterns]

## Structured Recommendations

### Current State Analysis
**Current Organization:** Brief assessment of existing window structure
**Main Issues:**
- Issue 1: Too many scattered tabs
- Issue 2: Mixed contexts in single windows

### Recommended Window Organization
1. **Development & Documentation**
   Purpose: Coding resources and API docs
   Estimated tabs: 25
   Priority: high

2. **Project Management & Communication** 
   Purpose: Work coordination and team tools
   Estimated tabs: 12
   Priority: medium

### Specific Actions
1. **CREATE NEW WINDOW** 
   - Description: Group all GitHub and documentation tabs
   - Benefit: Reduces context switching during development

## Current Window Details (for reference)
[Detailed breakdown of existing windows and domains]
```

## Requirements

- macOS (uses AppleScript for Chrome automation)
- Google Chrome running
- Node.js
- OpenAI API key (ChromeDump full mode and ChromeRecommend, not needed for ChromeDump `--fast` mode, ChromeKeep, or ChromeReorg)

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
