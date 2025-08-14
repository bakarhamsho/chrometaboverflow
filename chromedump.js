#!/usr/bin/env node

require('dotenv').config();

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const pLimit = require('p-limit');
const OpenAI = require('openai');

// Configuration
const REQUEST_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const WORDS_LIMIT = 30000;

// Rate limiting - sequential processing for better rate limit handling
const INITIAL_DELAY = 500; // 0.5s initial delay
const MAX_DELAY = 10000; // 10s max delay
const MAX_BACKOFF_ATTEMPTS = 5; // Give up after 5 attempts

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Domain skip list - domains that typically don't provide useful content
const SKIP_DOMAINS = [
    // Empty/placeholder pages
    'about:blank',
    'chrome://newtab',
    'chrome://',
    'moz-extension://',
    'chrome-extension://',
    
    // github blocks with 451
    'github.com',
    'gitlab.com',
    'bitbucket.org',
    
    // email
    'gmail.com',
    'outlook.com',
    'yahoo.com',
    
    // Sign-in/auth pages that won't have content
    'accounts.google.com',
    'login.microsoftonline.com',
    'github.com/login',
    'twitter.com/login',
    'facebook.com/login',
    'x.com/login',
    'linkedin.com/login',
    
    // Social media and forums (often have auth walls)
    // 'stackoverflow.com',
    // 'stackexchange.com',
    'quora.com',
    'medium.com/m/signin',
    'facebook.com',
    'instagram.com',
    // 'linkedin.com',
    'tiktok.com',
    'youtube.com/signin',

    // 451 block
    'www.google.com/maps',
    'r.jina.ai',
    
    // Calendar and scheduling (usually private/no useful content)
    'calendar.google.com',
    'outlook.live.com/calendar',
    'calendly.com',
    
    // Settings and admin pages
    'chrome://settings',
    'chrome://extensions',
    'about:config',
    
    // Error pages and restricted content
    'httpstatuses.com',
    'httpstatus.io',
    
    // Local development
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    
    // Common "new tab" or empty pages
    'newtab',
    'new-tab',
    'start.duckduckgo.com',
    
    // File sharing and cloud storage (often require auth)
    'drive.google.com',
    'dropbox.com',
    'onedrive.live.com',
    'icloud.com',
    
    // Shopping and e-commerce (often dynamic/personalized)
    'amazon.com/gp/cart',
    'amazon.com/ap/signin',
    'ebay.com/signin',
    'paypal.com/signin'
];

function shouldSkipDomain(url) {
    try {
        const domain = new URL(url).hostname.toLowerCase();
        const fullUrl = url.toLowerCase();
        
        return SKIP_DOMAINS.some(skipDomain => 
            domain === skipDomain || 
            domain.endsWith('.' + skipDomain) ||
            fullUrl.startsWith(skipDomain)
        );
    } catch (error) {
        // Invalid URL, skip it
        return true;
    }
}

function shouldSkipContentType(url) {
    const urlLower = url.toLowerCase();
    
    // Skip file extensions that won't have readable content
    const skipExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', 
                           '.zip', '.rar', '.tar', '.gz', '.mp4', '.avi', '.mov', '.mp3', 
                           '.wav', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'];
    
    return skipExtensions.some(ext => urlLower.includes(ext));
}

async function extractChromeTabs() {
    try {
        console.log('🔍 Step 1: Extracting Chrome tabs...');
        
        // JavaScript for Automation to get Chrome tabs
        const result = execSync(`osascript -l JavaScript -e '
            const chrome = Application("Google Chrome");
            chrome.includeStandardAdditions = true;
            
            const windows = chrome.windows();
            const tabData = [];
            
            for (let i = 0; i < windows.length; i++) {
                const window = windows[i];
                const tabs = window.tabs();
                const windowTabs = [];
                
                for (let j = 0; j < tabs.length; j++) {
                    const tab = tabs[j];
                    windowTabs.push({
                        title: tab.title(),
                        url: tab.url(),
                        index: j + 1,
                        loading: tab.loading()
                    });
                }
                
                tabData.push({
                    windowIndex: i + 1,
                    tabCount: tabs.length,
                    tabs: windowTabs
                });
            }
            
            JSON.stringify(tabData);
        '`, { encoding: 'utf8' });
        
        const tabData = JSON.parse(result.trim());
        const totalTabs = tabData.reduce((sum, window) => sum + window.tabs.length, 0);
        
        console.log(`✅ Successfully extracted ${totalTabs} tabs from ${tabData.length} windows`);
        
        return tabData;
        
    } catch (error) {
        if (error.message.includes('Google Chrome got an error')) {
            console.error('❌ Error: Cannot access Chrome.');
            console.error('💡 Make sure Google Chrome is running and you have granted permission for scripts to access it.');
            console.error('   You may need to allow access in System Preferences > Security & Privacy > Privacy > Automation');
        } else if (error.message.includes('Application isn\'t running')) {
            console.error('❌ Error: Google Chrome is not running.');
            console.error('💡 Please start Google Chrome and try again.');
        } else {
            console.error('❌ Error extracting tabs:', error.message);
        }
        throw error;
    }
}

// Exponential backoff delay function
async function exponentialBackoff(attempt) {
    const delay = Math.min(INITIAL_DELAY * Math.pow(2, attempt), MAX_DELAY);
    await new Promise(resolve => setTimeout(resolve, delay));
}

// Check if error warrants a backoff retry
function shouldRetryWithBackoff(error) {
    const message = error.message.toLowerCase();
    const status = error.status || 0;

    if (status === 451) return false; // github blocks with 451, dont bother retrying
    
    return status === 429 || // Too Many Requests
           status === 503 || // Service Unavailable
           status === 502 || // Bad Gateway
           message.includes('rate limit') ||
           message.includes('too many requests') ||
           message.includes('service unavailable');
}

async function fetchTabContentWithSummary(tab, attempt = 0, progressInfo = null) {
    // Check if we should skip this domain
    if (shouldSkipDomain(tab.url)) {
        return {
            ...tab,
            content: '',
            wordCount: 0,
            success: false,
            skipped: true,
            summary: 'Domain skipped',
            summaryGenerated: false,
            error: 'Domain skipped'
        };
    }
    
    // Check if we should skip this content type
    if (shouldSkipContentType(tab.url)) {
        if (progressInfo) {
            console.log(`⏭️  [${progressInfo.current}/${progressInfo.total}] Skipping: ${tab.title.substring(0, 50)}... (file type not readable)`);
        }
        return {
            ...tab,
            content: '',
            wordCount: 0,
            success: false,
            skipped: true,
            summary: 'Content type skipped',
            summaryGenerated: false,
            error: 'Content type skipped'
        };
    }
    
    try {
        // Step 1: Fetch content from Jina
        const jinaUrl = `https://r.jina.ai/${tab.url}`;
        if (progressInfo) {
            console.log(`📖 [${progressInfo.current}/${progressInfo.total}] Reading: ${tab.url.substring(0, 30)} ${tab.title.substring(0, 50)}...`);
        }
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
        
        const response = await fetch(jinaUrl, {
            signal: controller.signal,
            headers: {
                // 'User-Agent': 'Mozilla/5.0 (compatible; ChromeDump/1.0)',
                'X-Engine': 'direct',
                'X-Return-Format': 'markdown',
                'X-Timeout': '2'
            }
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
            error.status = response.status;
            throw error;
        }
        
        const content = await response.text();
        
        // Limit to first 30k words
        const words = content.split(/\s+/).filter(word => word.trim().length > 0);
        const limitedContent = words.slice(0, WORDS_LIMIT).join(' ');
        
        // Skip tabs with very little content
        if (words.length < 100) {
            return {
                ...tab,
                content: '',
                wordCount: words.length,
                success: false,
                skipped: true,
                summary: 'Too little content',
                summaryGenerated: false,
                error: 'Too little content'
            };
        }
        
        const tabWithContent = {
            ...tab,
            content: limitedContent,
            wordCount: words.length,
            success: true
        };
        
        // Step 2: Generate summary if content is substantial
        if (words.length >= 200) {
            try {
                if (progressInfo) {
                    console.log(`🤖 [${progressInfo.current}/${progressInfo.total}] Generating summary: ${tab.title.substring(0, 50)}...`);
                }
                
                const summaryResponse = await openai.chat.completions.create({
                    model: 'gpt-5-nano',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a helpful assistant that creates concise summaries of web page content. Provide a 1 sentence (max 2) summary focusing on the main topic and key points for the user. Use markdown formatting to **bold** key names and topics, and *italicize* key numbers and direct quotes, but dont use bullet points. Be specific and concise and avoid tropes and vague fluff.'
                        },
                        {
                            role: 'user',
                            content: `Please summarize this web page content:\n\nTitle: ${tab.title}\nURL: ${tab.url}\n\nContent:\n${limitedContent.substring(0, 10000)}${limitedContent.length > 10000 ? '...' : ''}`
                        }
                    ]
                });
                
                const summary = summaryResponse.choices[0]?.message?.content?.trim() || 'Summary not available';
                console.log(`✅ Content + Summary: ${summary.substring(0, 80)}...`);
                
                return {
                    ...tabWithContent,
                    summary,
                    summaryGenerated: true
                };
                
            } catch (summaryError) {
                console.log(`⚠️  Summary failed for: ${tab.title.substring(0, 50)}... (${summaryError.message})`);
                return {
                    ...tabWithContent,
                    summary: 'Summary generation failed',
                    summaryGenerated: false,
                    summaryError: summaryError.message
                };
            }
        } else {
            // Content too short for summary
            return {
                ...tabWithContent,
                summary: 'Short content - no summary needed',
                summaryGenerated: false
            };
        }
        
    } catch (error) {
        console.log(`⚠️  Failed to fetch content for: ${tab.url.substring(0, 50)}... (${error.message})`);
        
        // Check if we should retry with exponential backoff
        if (attempt < MAX_BACKOFF_ATTEMPTS && shouldRetryWithBackoff(error)) {
            const delay = Math.min(INITIAL_DELAY * Math.pow(2, attempt), MAX_DELAY);
            console.log(`🔄 Rate limited - retrying in ${delay/1000}s... (${attempt + 1}/${MAX_BACKOFF_ATTEMPTS})`);
            await exponentialBackoff(attempt);
            return fetchTabContentWithSummary(tab, attempt + 1, progressInfo);
        }
        
        // Regular retry for other errors
        if (attempt < MAX_RETRIES && !shouldRetryWithBackoff(error)) {
            console.log(`🔄 Retrying... (${attempt + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            return fetchTabContentWithSummary(tab, attempt + 1, progressInfo);
        }
        
        return {
            ...tab,
            content: '',
            wordCount: 0,
            success: false,
            summary: 'Content fetch failed',
            summaryGenerated: false,
            error: error.message
        };
    }
}

// Write progress to temporary file
function writeProgressToTempFile(processedTabs, currentIndex, total) {
    try {
        const timestamp = new Date().toISOString();
        const successCount = processedTabs.filter(tab => tab.success).length;
        const summaryCount = processedTabs.filter(tab => tab.summaryGenerated).length;
        
        let tempContent = `# Chrome Tabs Progress - ${timestamp}\n\n`;
        tempContent += `Progress: ${currentIndex}/${total} tabs processed\n`;
        tempContent += `Successful: ${successCount}, Summaries: ${summaryCount}\n\n`;
        
        processedTabs.forEach((tab, index) => {
            if (tab.success || tab.skipped) {
                let domain = 'unknown';
                try {
                    domain = new URL(tab.url).hostname;
                } catch (e) {
                    // Invalid URL, use fallback
                }
                tempContent += `${index + 1}. [${tab.title}](${tab.url}) (${domain})`;
                if (tab.summaryGenerated && tab.summary) {
                    tempContent += ` - ${tab.summary}`;
                } else if (tab.skipped) {
                    tempContent += ` - *${tab.error || 'Skipped'}*`;
                }
                tempContent += `\n\n`;
            }
        });
        
        fs.writeFileSync('open-tabs-progress.tmp.md', tempContent, 'utf8');
    } catch (error) {
        // Ignore errors writing temp file
    }
}

async function processTabsSequentially(tabData) {
    const stepStartTime = Date.now();
    console.log('\n📚 Step 2: Processing tabs sequentially with content reading and summarization...');
    
    // Flatten all tabs
    const allTabs = [];
    tabData.forEach(window => {
        window.tabs.forEach(tab => {
            allTabs.push({ ...tab, windowIndex: window.windowIndex });
        });
    });
    
    console.log(`🚀 Processing ${allTabs.length} tabs sequentially (natural rate limiting)...`);
    
    const processedTabs = [];
    const total = allTabs.length;
    const tempFileInterval = Math.max(5, Math.floor(total / 2.5)); // Write temp file every 2.5%
    
    for (let i = 0; i < allTabs.length; i++) {
        const tab = allTabs[i];
        const current = i + 1;
        
        console.log(`\n[${current}/${total}] Processing: ${tab.title.substring(0, 60)}...`);
        
        const result = await fetchTabContentWithSummary(tab, 0, { current, total });
        processedTabs.push(result);
        
        // Write progress to temp file periodically
        if (current % tempFileInterval === 0 || current === total) {
            writeProgressToTempFile(processedTabs, current, total);
            const elapsed = ((Date.now() - stepStartTime) / 1000).toFixed(1);
            const percent = ((current / total) * 100).toFixed(1);
            console.log(`📊 Progress saved: ${current}/${total} (${percent}%) - ${elapsed}s elapsed`);
        }
    }
    
    const stepElapsed = ((Date.now() - stepStartTime) / 1000).toFixed(1);
    const successfulReads = processedTabs.filter(tab => tab.success).length;
    const skippedTabs = processedTabs.filter(tab => tab.skipped).length;
    const failedReads = processedTabs.length - successfulReads - skippedTabs;
    const summariesGenerated = processedTabs.filter(tab => tab.summaryGenerated).length;
    
    console.log(`\n📊 Sequential processing complete (${stepElapsed}s):`);
    console.log(`   ✅ Successfully processed: ${successfulReads} tabs`);
    console.log(`   🤖 Summaries generated: ${summariesGenerated} tabs`);
    console.log(`   ⏭️  Skipped: ${skippedTabs} tabs`);
    console.log(`   ❌ Failed: ${failedReads} tabs`);
    
    // Reorganize back into window structure
    const processedTabData = tabData.map(window => ({
        ...window,
        tabs: processedTabs.filter(tab => tab.windowIndex === window.windowIndex)
    }));
    
    return processedTabData;
}


function generateFastMarkdown(tabData) {
    const timestamp = new Date().toLocaleString();
    const totalTabs = tabData.reduce((sum, window) => sum + window.tabs.length, 0);
    
    let markdown = `# Chrome Tabs Fast Dump - ${timestamp}\n\n`;
    markdown += `**${totalTabs} tabs across ${tabData.length} windows**\n\n`;
    
    tabData.forEach((window) => {
        markdown += `## Window ${window.windowIndex} (${window.tabCount} tabs)\n\n`;
        
        window.tabs.forEach((tab) => {
            let domain = 'unknown';
            try {
                domain = new URL(tab.url).hostname;
            } catch (e) {
                // Invalid URL, use fallback
            }
            
            markdown += `- [${tab.title}](${tab.url}) (${domain})\n`;
        });
        
        markdown += `\n`;
    });
    
    return markdown;
}

function generateMarkdown(tabData) {
    const timestamp = new Date().toLocaleString();
    const totalTabs = tabData.reduce((sum, window) => sum + window.tabs.length, 0);
    const tabsWithContent = tabData.reduce((sum, window) => 
        sum + window.tabs.filter(tab => tab.success).length, 0);
    const tabsSkipped = tabData.reduce((sum, window) => 
        sum + window.tabs.filter(tab => tab.skipped).length, 0);
    const tabsWithSummaries = tabData.reduce((sum, window) => 
        sum + window.tabs.filter(tab => tab.summaryGenerated).length, 0);
    
    let markdown = `# Chrome Tabs Export - ${timestamp}\n\n`;
    markdown += `**${totalTabs} tabs across ${tabData.length} windows**\n`;
    markdown += `- 📖 Content read: ${tabsWithContent} tabs\n`;
    markdown += `- ⏭️ Domains skipped: ${tabsSkipped} tabs\n`;
    markdown += `- 🤖 Summaries generated: ${tabsWithSummaries} tabs\n\n`;
    
    tabData.forEach((window) => {
        markdown += `- **Window ${window.windowIndex}** (${window.tabCount} tabs)\n`;
        
        window.tabs.forEach((tab) => {
            const domain = new URL(tab.url).hostname;
            
            // Main bullet point with title and domain
            markdown += `    - [${tab.title}](${tab.url}) (${domain})`;
            
            // Add summary if available
            if (tab.summaryGenerated && tab.summary) {
                markdown += ` - ${tab.summary}`;
            } else if (tab.skipped) {
                markdown += ` - *Domain skipped*`;
            } else if (!tab.success) {
                markdown += ` - *Content unavailable*`;
            }
            
            markdown += `\n`;
        });
        
        markdown += `\n`;
    });
    
    return markdown;
}

async function main() {
    const overallStartTime = Date.now();
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    const fastOnly = args.includes('--fast') || args.includes('-f');
    
    try {
        // Check for OpenAI API key only if not in fast mode
        if (!fastOnly && !process.env.OPENAI_API_KEY) {
            console.error('❌ Error: OPENAI_API_KEY environment variable is required for full mode');
            console.error('💡 Set it with: export OPENAI_API_KEY=your_api_key_here');
            console.error('💡 Or use --fast flag for fast dump only');
            process.exit(1);
        }
        
        // Show processing info
        if (fastOnly) {
            console.log('⚡ Fast mode enabled - tab titles and URLs only\n');
        } else {
            console.log(`🚀 Sequential processing with exponential backoff for rate limits`);
            console.log(`🚀 Rate limit backoff: ${INITIAL_DELAY/1000}s to ${MAX_DELAY/1000}s max\n`);
        }
        
        console.log(fastOnly ? '⚡ Starting fast Chrome tabs export...\n' : '🚀 Starting Chrome tabs export with content reading and AI summaries...\n');
        
        // Step 1: Extract Chrome tabs
        const step1Start = Date.now();
        const tabData = await extractChromeTabs();
        const step1Elapsed = ((Date.now() - step1Start) / 1000).toFixed(1);
        console.log(`⏱️  Step 1 completed in ${step1Elapsed}s`);
        
        // Step 1.5: Create fast dump
        const fastDumpStart = Date.now();
        console.log('\n⚡ Step 1.5: Creating fast dump of all tabs...');
        const fastMarkdown = generateFastMarkdown(tabData);
        const fastTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fastFilename = `open-tabs-fast-${fastTimestamp}.md`;
        const fastFilepath = path.join(process.cwd(), fastFilename);
        fs.writeFileSync(fastFilepath, fastMarkdown, 'utf8');
        const fastDumpElapsed = ((Date.now() - fastDumpStart) / 1000).toFixed(1);
        console.log(`📄 Fast dump saved: ${fastFilename}`);
        console.log(`⏱️  Step 1.5 completed in ${fastDumpElapsed}s`);
        
        if (fastOnly) {
            const totalElapsed = ((Date.now() - overallStartTime) / 1000).toFixed(1);
            const totalTabs = tabData.reduce((sum, window) => sum + window.tabs.length, 0);
            
            console.log('\n🎉 Fast export complete!');
            console.log(`📄 Fast dump: ${fastFilename}`);
            console.log(`⏱️  Total time: ${totalElapsed}s`);
            console.log(`📊 Statistics:`);
            console.log(`   - Total tabs: ${totalTabs}`);
            console.log(`   - Windows: ${tabData.length}`);
            
            return { fastDump: fastFilepath };
        }
        
        // Step 2: Process tabs sequentially with content and summaries
        const processedTabData = await processTabsSequentially(tabData);
        
        // Step 3: Generate and save markdown
        const step3Start = Date.now();
        console.log('\n📝 Step 3: Generating markdown file...');
        
        const markdown = generateMarkdown(processedTabData);
        
        // Write to file with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `open-tabs-${timestamp}.md`;
        const filepath = path.join(process.cwd(), filename);
        
        fs.writeFileSync(filepath, markdown, 'utf8');
        const step3Elapsed = ((Date.now() - step3Start) / 1000).toFixed(1);
        
        const totalTabs = tabData.reduce((sum, window) => sum + window.tabs.length, 0);
        const tabsWithContent = processedTabData.reduce((sum, window) => 
            sum + window.tabs.filter(tab => tab.success).length, 0);
        const tabsWithSummaries = processedTabData.reduce((sum, window) => 
            sum + window.tabs.filter(tab => tab.summaryGenerated).length, 0);
        const totalElapsed = ((Date.now() - overallStartTime) / 1000).toFixed(1);
        
        // Clean up temp file
        try {
            fs.unlinkSync('chrome-tabs-progress.tmp.md');
        } catch (error) {
            // Ignore if temp file doesn't exist
        }
        
        console.log(`⏱️  Step 3 completed in ${step3Elapsed}s`);
        console.log('\n🎉 Export complete!');
        console.log(`📄 Fast dump: ${fastFilename}`);
        console.log(`📄 Full export: ${filename}`);
        console.log(`⏱️  Total time: ${totalElapsed}s`);
        console.log(`📊 Statistics:`);
        console.log(`   - Total tabs: ${totalTabs}`);
        console.log(`   - Windows: ${tabData.length}`);
        console.log(`   - Content read: ${tabsWithContent}/${totalTabs} tabs (${((tabsWithContent/totalTabs)*100).toFixed(1)}%)`);
        console.log(`   - Summaries generated: ${tabsWithSummaries}/${totalTabs} tabs (${((tabsWithSummaries/totalTabs)*100).toFixed(1)}%)`);
        
        return { fullExport: filepath, fastDump: fastFilepath };
        
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

// Handle command line execution
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { 
    extractChromeTabs, 
    processTabsSequentially,
    fetchTabContentWithSummary, 
    generateFastMarkdown,
    generateMarkdown, 
    main 
};