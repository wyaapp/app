import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentionText, parseBio } from '../lib/bio.ts';
import { actionSchema, applyAction } from '../lib/model.ts';

const links=(text:string)=>parseBio(text).filter(part=>part.href);

test('Wya and explicit social mentions preserve their visible text and resolve to profile URLs',()=>{
  assert.deepEqual(links('With @Alex.Castro, github:alex-castro and instagram:@alex.castro.'),[
    {text:'@Alex.Castro',href:'https://wya.im/alex.castro'},
    {text:'github:alex-castro',href:'https://github.com/alex-castro'},
    {text:'instagram:@alex.castro',href:'https://www.instagram.com/alex.castro'},
  ]);
  assert.deepEqual(links('linkedin:alex youtube:alex tiktok:alex x:_alex_ bluesky:alex.bsky.social telegram:alex twitch:alex').map(part=>part.href),[
    'https://www.linkedin.com/in/alex','https://www.youtube.com/@alex','https://www.tiktok.com/@alex',
    'https://x.com/_alex_','https://bsky.app/profile/alex.bsky.social','https://t.me/alex','https://www.twitch.tv/alex',
  ]);
  assert.equal(links('GITHUB:Alex')[0].href,'https://github.com/Alex');
});

test('URLs include queries and fragments, preserve balanced parentheses, and exclude surrounding punctuation',()=>{
  assert.deepEqual(links('See (https://example.com/a_(b)?x=1&y=2#part). Also [https://wya.im/alex].'),[
    {text:'https://example.com/a_(b)?x=1&y=2#part',href:'https://example.com/a_(b)?x=1&y=2#part'},
    {text:'https://wya.im/alex',href:'https://wya.im/alex'},
  ]);
  assert.equal(links('([https://example.com/a)]!')[0].text,'https://example.com/a');
  assert.equal(links('http://example.com')[0].href,'http://example.com/');
});

test('email addresses, unknown platforms, malformed usernames, and unsafe URLs remain plain text',()=>{
  for(const text of ['alex@example.com','alex+tag@example.com','mailto:alex@example.com','@@alex',
    'mastodon:alex','mastodon:@alex','https://','javascript:alert(1)','data:text/html,test',
    'https://user:secret@example.com','https://example.com\\@evil.com','ftp://example.com/@alex',
    '@alex/path','@alex%2fpath','@alex+tag','@alex@example.com','@alex:secret','@áléx','@alex-',
    `@${'a'.repeat(40)}`,`github:${'a'.repeat(101)}`]) {
    assert.deepEqual(links(text),[],text);
  }
});

test('all source text survives parsing, including whitespace, punctuation, HTML, and non-ASCII text',()=>{
  for(const text of ['', 'ordinary bio', 'Olá 👋\nWith @alex, and @sam...',
    '<script>alert(1)</script> <img src=x onerror=alert(1)>',
    'Email alex@example.com. See https://example.com?q=hello&x=1!',
    '(@alex), github:alex; @sam?', 'bad @alex/path then @sam', '([https://example.com/a)]!']) {
    assert.equal(parseBio(text).map(part=>part.text).join(''),text);
  }
});

test('the mention helper accepts usernames only and never arbitrary destinations',()=>{
  assert.equal(mentionText('wya',' @Alex.Castro '),'@Alex.Castro');
  assert.equal(mentionText('github','@alex'),'github:alex');
  assert.equal(mentionText('x','_alex_'),'x:_alex_');
  for(const value of ['', '../alex', 'alex/name', 'https://example.com', 'alex?x=1', 'two words']) {
    assert.throws(()=>mentionText('github',value));
  }
  for(const value of ['.alex','alex.','_alex','a'.repeat(40)]) assert.throws(()=>mentionText('wya',value));
});

test('bio mentions use the existing plain-text action and snapshot format',()=>{
  const original={name:'Alex',bio:'Hello',theme:'lilac' as const,links:[]};
  const bio='Building with @sam. Code: github:alex. More: https://wya.im/alex';
  const next=applyAction(original,actionSchema.parse({action:'update_profile',expectedVersion:1,bio})).data;
  assert.equal(next.bio,bio);
  assert.equal(original.bio,'Hello');
  assert.equal(JSON.parse(JSON.stringify(next)).bio,bio);
  assert.equal(actionSchema.safeParse({action:'update_profile',expectedVersion:1,bio:'x'.repeat(281)}).success,false);
});
