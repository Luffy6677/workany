import { useState } from 'react';
import { Check, Copy, FileCode2 } from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useLanguage } from '@/shared/providers/language-provider';

import type { PreviewComponentProps } from './types';
import { inlineCssForWechat } from './utils';

// WeChat article standard width
const WECHAT_ARTICLE_WIDTH = 677;

export function WechatPreview({ artifact }: PreviewComponentProps) {
  const [copiedToWechat, setCopiedToWechat] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const { t } = useLanguage();

  // Copy as rich text (HTML) for pasting into WeChat editor
  const copyToWechat = async () => {
    if (!artifact.content) return;

    try {
      // Inline CSS styles for WeChat compatibility
      const inlinedHtml = inlineCssForWechat(artifact.content);

      const htmlBlob = new Blob([inlinedHtml], { type: 'text/html' });
      const textBlob = new Blob([inlinedHtml], { type: 'text/plain' });

      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob,
        }),
      ]);

      setCopiedToWechat(true);
      setTimeout(() => setCopiedToWechat(false), 2000);
    } catch (err) {
      console.error('[WechatPreview] Failed to copy:', err);
      // Fallback to plain text copy
      try {
        await navigator.clipboard.writeText(artifact.content);
        setCopiedToWechat(true);
        setTimeout(() => setCopiedToWechat(false), 2000);
      } catch {
        console.error('[WechatPreview] Fallback copy also failed');
      }
    }
  };

  // Copy raw HTML source code
  const copyHtml = async () => {
    if (!artifact.content) return;

    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopiedHtml(true);
      setTimeout(() => setCopiedHtml(false), 2000);
    } catch (err) {
      console.error('[WechatPreview] Failed to copy HTML:', err);
    }
  };

  if (!artifact.content) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-muted-foreground text-sm">
          {t.preview.previewNotAvailable}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-border/50 bg-muted/30 flex shrink-0 items-center justify-between border-b px-4 py-2">
        <span className="text-muted-foreground text-sm">
          {t.preview.wechatPreview}
        </span>

        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-2">
            {/* Copy to WeChat button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={copyToWechat}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                >
                  {copiedToWechat ? (
                    <>
                      <Check className="size-3.5" />
                      <span>{t.preview.copiedToWechat}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      <span>{t.preview.copyToWechat}</span>
                    </>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{t.preview.copyToWechatHint}</p>
              </TooltipContent>
            </Tooltip>

            {/* Copy HTML source button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={copyHtml}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors"
                >
                  {copiedHtml ? (
                    <>
                      <Check className="size-3.5 text-emerald-500" />
                      <span className="text-emerald-500">
                        {t.preview.copied}
                      </span>
                    </>
                  ) : (
                    <>
                      <FileCode2 className="size-3.5" />
                      <span>{t.preview.copyHtml}</span>
                    </>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{t.preview.copyHtmlHint}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {/* Preview area */}
      <div className="bg-muted/20 flex-1 overflow-auto p-4">
        {/* WeChat article container */}
        <div
          className="bg-background mx-auto shadow-sm"
          style={{
            width: `${WECHAT_ARTICLE_WIDTH}px`,
            maxWidth: '100%',
            minHeight: '100%',
          }}
        >
          {/* Article content with WeChat-like styles */}
          <div
            className="wechat-article-content"
            style={{
              padding: '20px 16px',
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif',
              fontSize: '17px',
              lineHeight: '1.75',
              color: '#333',
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: artifact.content }}
          />
        </div>
      </div>

      {/* Status bar */}
      <div className="border-border/50 bg-muted/30 text-muted-foreground shrink-0 border-t px-4 py-1.5 text-xs">
        {t.preview.wechatWidthHint}
      </div>
    </div>
  );
}
