import { App, Editor, MarkdownView, Modal, Notice, Plugin, requestUrl } from 'obsidian';

export default class UrlNamer extends Plugin {

    async onload() {
        this.addCommand({
            id: 'name-url-links-in-selection',
            name: 'Name the URL links in the selected text',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                const modal = new MsgModal(this.app);
                const loadingIndicator = new Notice('Fetching titles for selected text...', 0);
                UrlTagger.getTaggedText(editor.getSelection())
                    .then(taggedText => {
                        editor.replaceSelection(taggedText);
                    })
                    .catch(e => {
                        const message = e instanceof Error ? e.message : String(e);
                        modal.showMsg(message);
                    })
                    .finally(() => {
                        loadingIndicator.hide();
                    });
            }
        });
    }

}

class MsgModal extends Modal {

    constructor(app: App) {
        super(app);
    }

    msg: string;

    showMsg(theMsg: string) {
        this.msg = theMsg;
        this.open();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.setText(this.msg);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

}

class UrlTagger {

    // Capture the preceding character (or empty string for start-of-line) in group 1,
    // and the URL in group 2. This avoids lookbehind assertions (unsupported on iOS < 16.4).
    static rawUrlPattern = /(^|[\s([])((?:https?:\/\/)?[a-zA-Z0-9]+[a-zA-Z0-9\-_.]*\.[a-z]{2,6}[^\s]*\b)/gim;

    static async getTaggedText(selectedText: string) {
        const promises: Promise<string>[] = [];

        selectedText.replace(UrlTagger.rawUrlPattern, (fullMatch, prefix: string, url: string, offset: number) => {
            if (UrlTagger.isAlreadyLinked(selectedText, offset, prefix)) {
                return fullMatch;
            }
            promises.push(UrlTitleFetcher.getNamedUrlTag(url));
            return fullMatch;
        });

        const namedTags = await Promise.all(promises);

        new Notice(`Processed ${namedTags.length} urls.`);

        return selectedText.replace(UrlTagger.rawUrlPattern, (fullMatch, prefix: string, url: string, offset: number) => {
            if (UrlTagger.isAlreadyLinked(selectedText, offset, prefix)) {
                return fullMatch;
            }
            return prefix + (namedTags.shift() ?? url);
        });
    }

    // Returns true if the URL is already inside a Markdown link like [text](url)
    private static isAlreadyLinked(text: string, offset: number, prefix: string): boolean {
        return prefix === '(' && text.charAt(offset - 1) === ']';
    }

}

class UrlTitleFetcher {

    static htmlTitlePattern = /<title>([^<]*)<\/title>/im;
    static wxTitlePattern = /<meta property="og:title" content="([^<]*)" \/>/im;

    static isValidUrl(s: string): boolean {
        try {
            new URL(s);
            return true;
        } catch {
            return false;
        }
    }

    static parseTitle(reqUrl: string, body: string): string {
        const { hostname } = new URL(reqUrl);
        const match = hostname === 'mp.weixin.qq.com' ?
            body.match(this.wxTitlePattern)
            : body.match(this.htmlTitlePattern);

        if (!match || typeof match[1] !== 'string') {
            throw new Error('Unable to parse the title tag');
        }

        return match[1];
    }

    static async getNamedUrlTag(url: string): Promise<string> {
        const reqUrl = url.startsWith('http') ? url : `http://${url}`;

        if (!this.isValidUrl(reqUrl)) {
            new Notice(`${url} is not a valid URL.`);
            return url;
        }

        try {
            const res = await requestUrl({ url: reqUrl });
            if (res.status != 200) {
                throw new Error(`status code ${res.status}`);
            }

            const body = res.text;
            const title = this.parseTitle(reqUrl, body);
            return `[${title}](${url})`;
        } catch (error) {
            new Notice(`Error handling URL ${url}: ${String(error)}`);
            return url;
        }
    }

}
