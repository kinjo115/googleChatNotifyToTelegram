# Google Chat to Telegram

Chrome extension that forwards new [Google Chat](https://chat.google.com/) messages to a Telegram bot.

Leave the Chat tab open. It can stay in the background. A notification is sent only when Google Chat shows a new-message badge. Messages with no badge are not sent. Your own messages are skipped unless you turn that option on.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder.
4. Pin **Google Chat to Telegram**, then open **Settings**.

After you change the extension code, click **Reload** on `chrome://extensions` and refresh the Google Chat tab.

## Telegram

1. In Telegram, open `@BotFather` and send `/newbot`. Copy the bot token.
2. Open your new bot and send it any message.
3. In the extension settings, paste the token and click **Find chat id**.
4. Click **Save**, then **Send test**.

The test message should appear in that Telegram chat. A red **!** on the extension icon means the last send failed. Open the popup to read the error.

## Settings

| Option | What it does |
| --- | --- |
| Bot token | Token from BotFather. Stored only in this browser. |
| Telegram chat id | Chat that receives the notifications. |
| Forward new messages | Turns forwarding on or off. |
| Also forward messages I send | Includes messages you post yourself. Off by default. |

## While it is running

- Keep one `https://chat.google.com/` tab open and signed in.
- A thread badge or a left-nav badge is required. The badge can be an unread count, “新しいメッセージ”, or “unread”.
- Wait a few seconds after the tab loads. Badges already on screen from the last 7 days are sent once, newest first.
- A badge that appears after that is sent as `Google Chat`, the room or sender name, and the reply text.

Forwarding stops if the Chat tab is closed or the computer sleeps. Chrome may also throttle a tab that has been in the background for a long time.
