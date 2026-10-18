# Automations

Navi answers questions, but a university is more than questions. It is requests, document flow, mailings. This folder holds five n8n workflows that embed the system into those processes.

The logic is simple: the backend reports an event, and n8n decides what to do with it. This split is justified because routes and recipients differ at every university, and hard-coding them would be wrong. An administrator changes them with a mouse, not a developer.

## Import

**Workflows → Import from File**, one file at a time.

Then in **Settings → Variables** set what the workflows expect to find:

| Variable | Value | Needed for |
|---|---|---|
| `NAVI_API_URL` | the backend address, like `https://navi-backend-xxxx.onrender.com` | 02, 03 |
| `NAVI_TELEGRAM_CHAT_ID` | the ID of the dean's office chat or group | 01, 03 |
| `NAVI_DOCS_SOURCE_URL` | the university's document source | 02 |

To test 02 you can use the ready-made set from this same folder:

```
https://raw.githubusercontent.com/emiontheautismspectrum/Navi/main/n8n/sample-docs.json
```

Six documents, two per role. It is handy until the real export from the university is connected.

To send to Telegram you need a bot: message @BotFather with `/newbot`, get a token, and add it once in **Credentials → New → Telegram API**.

---

## 01 · Requests to the dean's office

When an agent cannot answer from its documents, the user submits a request. The backend sends an event here, and the workflow assigns a number and picks the recipient by the author's role: a student goes to the study department, a teacher to the faculty department, an administrator to the chancellery. The finished message goes to Telegram.

This routing is exactly what justifies n8n here. The backend can send a message itself, but deciding which department to route a question to should be up to someone who knows the structure of a specific university.

**Setup.** After import, open the "Event from Navi" node and copy the webhook's Production URL. It must be Production, because Test only works while the tab is open. Put it in the backend's environment variables:

```
navi-backend → Environment → N8N_WEBHOOK_URL
```

The backend sends the event and does not wait for a response. If n8n is off, unavailable, or not yet configured, the user will not notice: the request just will not be created, and everything else keeps working.

---

## 02 · Library sync

Every morning at six the workflow pulls documents from the university's source, filters out empty and too-short ones, and loads the rest into the library via `/documents/upload`. A document immediately lands in its role's search index and takes part in answers.

The source must return an array like this:

```json
[
  { "title": "Exam session regulations", "content": "full text…", "role": "student" },
  { "title": "Order No. 128",            "content": "full text…", "role": "admin"   }
]
```

The `role` field decides which agent the document becomes available to. This is the point where access separation is set on input rather than after the fact. If the role is missing or unknown, the document goes to the student agent.

The schedule is changed in the first node: the expression `0 6 * * *` means daily at six in the morning.

---

## 03 · Morning digest

On weekdays at eight the workflow asks each agent its own question via `/chat`, collects the answers along with links to sources, and sends them as one message.

The questions are intentionally different. An identical query would give the three agents similar answers, while the point of the role model is the opposite: a student needs deadlines, a teacher needs the department's organizational materials, an administrator needs the review times for applications. The answers are assembled from different documents, because the agents' indexes are different too.

The question texts are edited in the "Question for each role" node.

---

## Testing

Requests are tested live: open Navi, ask a question, and press "Send a request to the dean's office" under the answer. The message should arrive in Telegram within a couple of seconds.

The other two workflows do not need to wait for their schedule: the **Execute Workflow** button runs them manually. After the sync, open the library in Navi and the new documents will be in the list.

What exactly arrived in n8n and how the run ended is visible in the **Executions** section.

## If it doesn't work

| Symptom | Usually the cause |
|---|---|
| The request does not arrive | `N8N_WEBHOOK_URL` is not set in Render, or the Test URL was copied instead of Production |
| The workflow fires but Telegram is silent | The bot credentials were not added, the chat ID is wrong, or the bot is not in the group |
| Documents are not uploaded | The source returns a different format, or the text is shorter than 120 characters and is dropped by the filter |
| The digest is empty | The backend was asleep: on the Render free tier the first request after idle takes up to a minute |
| The voice summary is not sent | `ELEVENLABS_API_KEY` is not set in Render, or the agent's answer is longer than the speech limit |


---

## 04 · Keep the service awake

On the Render free tier a service goes to sleep after fifteen minutes of inactivity, and the first request after that takes up to a minute. For a demo that is bad: a person opens the link, sees a frozen interface, and leaves.

The workflow pings `/health` every ten minutes. The service never gets to fall asleep, so answers are always fast. If the check fails, a warning goes to Telegram, so you learn about an outage before a user reports it.

It needs no additional variables: it works on the same `NAVI_API_URL` and `NAVI_TELEGRAM_CHAT_ID`.

---

## 05 · Voice summary

The same as the digest, but a student receives not text but a voice message: the workflow asks the agent, runs the answer through `/tts`, and sends the audio to Telegram.

The agent is separately asked to answer in connected text without lists and headings, because what reads well by eye sounds like an enumeration of points by ear.

It needs `ELEVENLABS_API_KEY` in the backend variables. Without it the workflow stops at the speech step, while the others keep working.
