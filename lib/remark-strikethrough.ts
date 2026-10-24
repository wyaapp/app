import type { Processor } from 'unified';
import {
  gfmStrikethroughFromMarkdown,
  gfmStrikethroughToMarkdown,
} from 'mdast-util-gfm-strikethrough';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import type {} from 'remark-parse';
import type {} from 'remark-stringify';

/** Add only ~~strikethrough~~ while keeping the existing Markdown vocabulary. */
export function remarkStrikethrough(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(gfmStrikethrough({ singleTilde: false }));
  (data.fromMarkdownExtensions ??= []).push(gfmStrikethroughFromMarkdown());
  (data.toMarkdownExtensions ??= []).push(gfmStrikethroughToMarkdown());
}
