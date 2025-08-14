#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');

// Function to extract URLs from markdown content
function extractUrlsFromMarkdown(markdownContent) {
    const urls = new Set();
    
    // Match markdown links [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(markdownContent)) !== null) {
        const url = match[2];
        if (url.startsWith('http://') || url.startsWith('https://')) {
            urls.add(url);
        }
    }
    
    // Match bare URLs (http/https)
    const urlRegex = /(https?:\/\/[^\s\)]+)/g;
    while ((match = urlRegex.exec(markdownContent)) !== null) {
        urls.add(match[1]);
    }
    
    return Array.from(urls);
}

// Function to get all open Chrome tabs (reused from chromedump.js)
async function extractChromeTabs() {
    try {
        console.log('🔍 Reading open Chrome tabs...');
        
        // JavaScript for Automation to get Chrome tabs
        const result = execSync(`osascript -l JavaScript -e '
            const chrome = Application("Google Chrome");
            chrome.includeStandardAdditions = true;
            
            const windows = chrome.windows();
            const tabData = [];
            
            for (let i = 0; i < windows.length; i++) {
                const window = windows[i];
                const tabs = window.tabs();
                
                for (let j = 0; j < tabs.length; j++) {
                    const tab = tabs[j];
                    tabData.push({
                        title: tab.title(),
                        url: tab.url(),
                        windowIndex: i + 1,
                        tabIndex: j + 1,
                        loading: tab.loading()
                    });
                }
            }
            
            JSON.stringify(tabData);
        '`, { encoding: 'utf8' });
        
        const tabData = JSON.parse(result.trim());
        console.log(`✅ Found ${tabData.length} open tabs`);
        
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

// Function to close specific tabs by URL (more robust than by index)
async function closeChromeTabs(tabsToClose) {
    if (tabsToClose.length === 0) {
        console.log('✅ No tabs to close');
        return { closed: [], failed: [] };
    }
    
    console.log(`🗑️  Closing ${tabsToClose.length} tabs...`);
    
    const urlsToClose = new Set(tabsToClose.map(tab => tab.url));
    const closedUrls = [];
    const failedUrls = [];
    
    try {
        // Re-read current Chrome tabs to get fresh indices
        console.log('📱 Re-reading current Chrome tabs...');
        const currentTabs = await extractChromeTabs();
        
        // Filter to only tabs we want to close that still exist
        const tabsStillOpen = currentTabs.filter(tab => urlsToClose.has(tab.url));
        
        if (tabsStillOpen.length === 0) {
            console.log('✅ No matching tabs found - they may have already been closed');
            return { closed: [], failed: [] };
        }
        
        console.log(`🔍 Found ${tabsStillOpen.length} matching tabs still open`);
        
        // Sort by windowIndex desc, then tabIndex desc to close from right to left
        tabsStillOpen.sort((a, b) => {
            if (a.windowIndex !== b.windowIndex) {
                return b.windowIndex - a.windowIndex;
            }
            return b.tabIndex - a.tabIndex;
        });
        
        // Close tabs one by one with error handling
        for (let i = 0; i < tabsStillOpen.length; i++) {
            const tab = tabsStillOpen[i];
            const progress = `[${i + 1}/${tabsStillOpen.length}]`;
            
            try {
                console.log(`⏳ ${progress} Closing: ${tab.title.substring(0, 60)}...`);
                
                const script = `tell application "Google Chrome"
                    close tab ${tab.tabIndex} of window ${tab.windowIndex}
                end tell`;
                
                // Write script to temporary file
                const tempScriptPath = path.join(process.cwd(), 'temp_close_single_tab.scpt');
                fs.writeFileSync(tempScriptPath, script, 'utf8');
                
                try {
                    execSync(`osascript "${tempScriptPath}"`, { encoding: 'utf8' });
                    closedUrls.push(tab.url);
                    console.log(`✅ ${progress} Closed: ${tab.url}`);
                } finally {
                    // Clean up temp file
                    try {
                        fs.unlinkSync(tempScriptPath);
                    } catch (cleanupError) {
                        // Ignore cleanup errors
                    }
                }
                
                // Small delay to avoid overwhelming Chrome and allow indices to update
                if (i < tabsStillOpen.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
            } catch (error) {
                console.log(`⚠️  ${progress} Failed to close: ${tab.url} (${error.message})`);
                failedUrls.push(tab.url);
                // Continue with next tab instead of failing entirely
            }
        }
        
        console.log(`\n📊 Summary:`);
        console.log(`✅ Successfully closed: ${closedUrls.length} tabs`);
        console.log(`❌ Failed to close: ${failedUrls.length} tabs`);
        
        if (closedUrls.length > 0) {
            console.log('\n🗑️  Successfully closed URLs:');
            closedUrls.forEach((url, index) => {
                console.log(`   ${index + 1}. ${url}`);
            });
        }
        
        if (failedUrls.length > 0) {
            console.log('\n⚠️  Failed to close URLs:');
            failedUrls.forEach((url, index) => {
                console.log(`   ${index + 1}. ${url}`);
            });
        }
        
        return { closed: closedUrls, failed: failedUrls };
        
    } catch (error) {
        console.error('❌ Error in tab closing process:', error.message);
        return { closed: closedUrls, failed: failedUrls };
    }
}

async function main() {
    try {
        // Check if markdown filename argument is provided
        const markdownFile = process.argv[2];
        if (!markdownFile) {
            console.error('❌ Error: Please provide a markdown filename as the first argument');
            console.error('💡 Usage: node chromekeep.js <markdown-file>');
            process.exit(1);
        }
        
        // Check if the markdown file exists
        if (!fs.existsSync(markdownFile)) {
            console.error(`❌ Error: Markdown file '${markdownFile}' not found`);
            process.exit(1);
        }
        
        console.log(`📄 Reading URLs from: ${markdownFile}`);
        
        // Read and parse markdown file
        const markdownContent = fs.readFileSync(markdownFile, 'utf8');
        const markdownUrls = extractUrlsFromMarkdown(markdownContent);
        
        console.log(`🔗 Found ${markdownUrls.length} URLs in markdown file`);
        
        // Get all open Chrome tabs
        const chromeTabs = await extractChromeTabs();
        
        // Find tabs that are NOT in the markdown file
        const tabsToClose = chromeTabs.filter(tab => {
            return !markdownUrls.includes(tab.url);
        });
        
        if (tabsToClose.length === 0) {
            console.log('✅ All open tabs are already saved in your markdown file!');
            console.log('🎉 Nothing to close.');
            return;
        }
        
        console.log(`\n📋 Found ${tabsToClose.length} tabs not in your markdown file:`);
        
        // Prepare choices for inquirer
        const choices = tabsToClose.map(tab => ({
            name: `${tab.title} (${tab.url})`,
            // name: `${tab.title} (${new URL(tab.url).hostname})`,
            value: tab,
            checked: true // All selected by default
        }));
        
        // Show multiselect prompt
        const answers = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'selectedTabs',
                message: 'Select tabs to close (all selected by default):',
                choices: choices,
                pageSize: 15 // Show up to 15 items at once
            }
        ]);
        
        // Confirm before closing
        if (answers.selectedTabs.length > 0) {
            const confirmAnswer = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirmClose',
                    message: `Are you sure you want to close ${answers.selectedTabs.length} selected tabs?`,
                    default: true
                }
            ]);
            
            if (confirmAnswer.confirmClose) {
                const result = await closeChromeTabs(answers.selectedTabs);
                
                if (result.closed.length > 0) {
                    console.log(`\n🎉 Successfully closed ${result.closed.length} tabs!`);
                } else if (result.failed.length === 0) {
                    console.log(`\n✅ No tabs needed closing (they may have already been closed)`);
                } else {
                    console.log(`\n⚠️  Completed with ${result.failed.length} failures`);
                }
            } else {
                console.log('❌ Operation cancelled');
            }
        } else {
            console.log('❌ No tabs selected for closing');
        }
        
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
    extractUrlsFromMarkdown,
    extractChromeTabs,
    closeChromeTabs,
    main
};