export const emailCases = [
  { input: 'Hello world.', output: 'Hello world.' },
  { input: 'alex@example.com', output: '[REDACTED_EMAIL]' },
  { input: 'Contact alex+support@example.co.uk now.', output: 'Contact [REDACTED_EMAIL] now.' },
  { input: '(Alex.Rivera@EXAMPLE.COM), next', output: '[REDACTED_EMAIL] next' },
  { input: '世界alex@example.com🙂\tOK', output: '[REDACTED_EMAIL]\tOK' },
  { input: 'alex@example.com,sam@example.org', output: '[REDACTED_EMAIL]' },
  { input: 'alex@example.com\nsam@example.org', output: '[REDACTED_EMAIL]\n[REDACTED_EMAIL]' },
  { input: 'alex@example alex@localhost x@y.c x@-bad.com', output: 'alex@example alex@localhost x@y.c x@-bad.com' },
  { input: '"alex"@example.com', output: '"alex"@example.com' },
  { input: 'alex@[127.0.0.1]', output: 'alex@[127.0.0.1]' },
  // Substring policy intentionally permits these false positives.
  { input: 'a..b@example.com', output: '[REDACTED_EMAIL]' },
  { input: 'address=alex@example.com/path', output: '[REDACTED_EMAIL]' },
] as const;
