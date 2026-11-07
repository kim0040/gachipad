/*
 * English text of the guide pages (draft, to be rewritten by a writer). It lives here, not in
 * packages/i18n, so it loads with the guide pages instead of with every route; the keys are still
 * `guide.*` and copy.test.ts holds this file and copy-ko.ts to the same rules as the app dictionaries.
 * Texts shared with the home page (`intro.*`, `shortcuts.*`, `share.dialog.*`, `template.*`) come
 * from the main dictionary.
 */
export const guideEn = {
  // ── Shared ──
  "guide.toc.title": "On this page",
  "guide.nav.label": "More guides",
  "guide.nav.prev": "Previous",
  "guide.nav.next": "Next",
  "guide.yes": "Yes",
  "guide.no": "No",
  "guide.loading": "Loading the page…",

  // ── How it works ──
  "guide.how.title": "How it works",
  "guide.how.lead":
    "Create a share, tell people how to join, and edit together. This page walks through each step and the controls the owner has.",
  "guide.how.toc.create": "Create a share",
  "guide.how.toc.tell": "Tell people how to join",
  "guide.how.toc.edit": "Edit together",
  "guide.how.toc.files": "Adding files",
  "guide.how.toc.roles": "Owners, editors and viewers",
  "guide.how.toc.control": "Control who joins",
  "guide.how.toc.offline": "When the connection drops",

  "guide.how.create.title": "Create a share",
  "guide.how.create.body1":
    "Select Create a share on the home page, or start from a template. With the default settings you don't sign up or sign in, and you become the owner of the share. If the administrator turned guests off, you sign in first.",
  "guide.how.create.body2":
    "Every share has an address of 8 letters and digits and a join code of 6 digits. Both open the same share.",
  "guide.how.create.templatesLink": "About templates",

  "guide.how.tell.title": "Tell people how to join",
  "guide.how.tell.lead": "There are five ways. Use whichever is quickest where you are.",
  "guide.how.tell.code.title": "Join code",
  "guide.how.tell.code.body":
    "Give people the 6 digits. They type them on the home page, or add them to the address, like /482913.",
  "guide.how.tell.qr.title": "QR code",
  "guide.how.tell.qr.body":
    "Open the Share window and point a phone camera at the code. The phone has to be on the same network. Show full screen puts a large code and QR code on a projector.",
  "guide.how.tell.nearby.title": "Nearby shares",
  "guide.how.tell.nearby.body":
    "Shares that are open on your network are listed on the home page. Select one to join. A share with a PIN or with approval turned on is never listed, and the owner can hide any share.",
  "guide.how.tell.send.title": "Send to a person",
  "guide.how.tell.send.body":
    "Search for a name in the Share window and send. An invite appears on their screen, with a note of up to 200 characters if you add one. Only people who have gachipad open are in the list.",
  "guide.how.tell.room.title": "Show to the whole room",
  "guide.how.tell.room.body":
    "One button puts the share in front of everyone in your room, or on the network if no rooms are set up. You confirm first, and each person gets a notification with a button to open it.",
  "guide.how.tell.shortcut": "The Share window is in the top bar. The shortcut is",
  "guide.how.tell.networkLink": "Why this is quicker on one network",

  "guide.how.edit.title": "Edit together",
  "guide.how.edit.lead":
    "Everyone types in the same file at once. Edits are merged, so two people changing the same line don't overwrite each other.",
  "guide.how.edit.cursors.title": "Cursors with names",
  "guide.how.edit.cursors.body":
    "Each person has a colored cursor and a name tag, so you can see who is where. When a crowd makes it busy, change how they are shown in Settings under Other people's cursors.",
  "guide.how.edit.follow.title": "Follow someone",
  "guide.how.edit.follow.body":
    "Select a person in the top bar and choose Follow. Your view scrolls along with theirs until you stop.",
  "guide.how.edit.files.title": "Several files",
  "guide.how.edit.files.body":
    "A share can hold several files and folders. Each file’s language follows its name, and the owner can let participants change it.",
  "guide.how.edit.comments.title": "Comments",
  "guide.how.edit.comments.body":
    "Attach a comment to a line or a selection. It stays with that code while the text around it changes, and can be marked as resolved.",
  "guide.how.edit.lock.title": "Lock editing",
  "guide.how.edit.lock.body":
    "The owner can lock editing so that only they can change the code, for example while explaining something.",

  "guide.how.files.title": "Adding files",
  "guide.how.files.lead":
    "There are four ways to bring files from your computer into a share. Owners can always use them, and editors can once the owner allows participants to add files in the Share window.",
  "guide.how.files.drag.title": "Drag onto the window",
  "guide.how.files.drag.body":
    "Drag files, folders or a .zip anywhere onto the share. An overlay covers the window, and dropping adds them right away. Dropped on the home page, they start a new share.",
  "guide.how.files.button.title": "The upload button",
  "guide.how.files.button.body":
    "Where dragging is hard, such as on a phone, use Upload files in the more menu. You can pick files, and on a computer a whole folder too.",
  "guide.how.files.paste.title": "Copy and paste",
  "guide.how.files.paste.body":
    "Files copied in your file manager or Finder are added when you paste them anywhere on the share page.",
  "guide.how.files.zip.title": ".zip files and folders",
  "guide.how.files.zip.body":
    "A .zip is unpacked with its folders kept, and a folder brings every file inside it. Folders such as .git, node_modules and __pycache__ are left out.",
  "guide.how.files.duplicate.title": "When the name already exists",
  "guide.how.files.duplicate.body":
    "With the same name and the same content, nothing new is made and the existing file opens. With the same name and different content, the new one is added as main (2).py and the existing file is not touched.",
  "guide.how.files.skipped.title": "What is skipped",
  "guide.how.files.skipped.body":
    "Files that are not text, files over {perFile} MB, more than {max} files at once, files that go over the share's size limit ({doc} MB, set by this server's administrator) and files that cannot be read are skipped. A notice names each skipped file and says why.",
  "guide.how.files.viewer":
    "People who joined as viewers cannot add files, and dropping one tells them why.",

  "guide.how.roles.title": "Owners, editors and viewers",
  "guide.how.roles.lead": "Everyone in a share has one of three roles.",
  "guide.how.roles.owner.title": "Owner",
  "guide.how.roles.owner.body":
    "Created the share. Sets who can join and edit, opens the history, removes people and can lock editing.",
  "guide.how.roles.edit.title": "Can edit",
  "guide.how.roles.edit.body":
    "Can change the code. Cannot change the access settings or open the history.",
  "guide.how.roles.view.title": "View only",
  "guide.how.roles.view.body": "Can read the code but cannot change it.",
  "guide.how.roles.default":
    "People who join get the role the owner picked as the default: edit or view only.",
  "guide.how.roles.table.caption": "What each role can do",
  "guide.how.roles.table.action": "Action",
  "guide.how.roles.table.edit": "Change the code",
  "guide.how.roles.table.history": "Open the history",
  "guide.how.roles.table.access": "Change the access settings",
  "guide.how.roles.table.remove": "Remove or block people",
  "guide.how.roles.table.lock": "Lock editing",
  "guide.how.roles.table.note": "While editing is locked, only the owner can change the code.",

  "guide.how.control.title": "Control who joins",
  "guide.how.control.lead":
    "The owner sets these in the Share window. They can be combined, and they apply right away.",
  "guide.how.control.mock": "The access settings in the Share window",
  "guide.how.control.view.title": "View-only link and edit link",
  "guide.how.control.view.body":
    "Set the default to View only and people who join can read but not edit. Copy the separate edit link for the people who should edit. It ends in #key= followed by the key. Browsers don't send that part with the page request, so it stays out of server logs and addresses; gachipad sends it once, in the join request, so the server can check it. After the link opens, the key is removed from the address bar and the server remembers the edit right for that browser.",
  "guide.how.control.pin.title": "PIN lock",
  "guide.how.control.pin.body":
    "Lock a share with a PIN of {min} to {max} characters, and give the PIN to people separately from the link. After {attempts} wrong tries a person has to wait {minutes} minutes. Setting a new PIN asks everyone to enter it again.",
  "guide.how.control.approval.title": "Approval before joining",
  "guide.how.control.approval.body":
    "New people see a waiting screen until you let them in. If you decline, they can ask again.",
  "guide.how.control.nearby.title": "Hide from nearby",
  "guide.how.control.nearby.body":
    "Turn off Show in nearby shares to keep the share out of the lists on the home page. Shares with a PIN or approval are never listed.",
  "guide.how.control.remove.title": "Remove and block",
  "guide.how.control.remove.body":
    "Remove someone from the People here list. They can come back with the code or the link. Choose Remove and block and they can't join that share again.",

  "guide.how.offline.title": "When the connection drops",
  "guide.how.offline.body1":
    "If the connection drops, a banner says you are offline. Keep typing. Your changes are kept and merge with everyone else's when the connection comes back.",
  "guide.how.offline.body2":
    "Whether changes survive closing the tab depends on the offline copy. The first time you open the editor, gachipad asks if it may keep offline copies on that device. If you say no, changes that have not reached the server exist only in the open tab, and the banner says so.",
  "guide.how.offline.body3":
    "If the owner removed you, or the share asked for a PIN or approval again while you were away, you have to join again, and changes that were not sent can't be kept.",

  // ── Features ──
  "guide.features.title": "Features",
  "guide.features.lead":
    "What gachipad does once you are in a share. It covers what sharing code needs and nothing beyond that.",
  "guide.features.toc.languages": "Syntax highlighting",
  "guide.features.toc.merge": "Conflict-free editing",
  "guide.features.toc.files": "Files and folders",
  "guide.features.toc.history": "History and restore",
  "guide.features.toc.download": "Download",
  "guide.features.toc.shortcuts": "Keyboard shortcuts",
  "guide.features.toc.settings": "Editor settings",
  "guide.features.toc.cursors": "Other people's cursors",
  "guide.features.toc.lab": "Lab mode",
  "guide.features.toc.templates": "Templates",
  "guide.features.toc.more": "Also included",

  "guide.features.languages.title": "Syntax highlighting",
  "guide.features.languages.body1":
    "More than 200 languages, each with its own grammar and colors. The language comes from the file name or is detected from the text, and can be changed from the status bar. The change applies to everyone in the share.",
  "guide.features.languages.body2":
    "Every token color meets a contrast ratio of 4.5:1 against the editor theme's background, in the dark and the light themes.",
  "guide.features.languages.searchLabel": "Search languages",
  "guide.features.languages.placeholder": "Name, alias or file extension",
  "guide.features.languages.shown": "Showing {shown} of {total}",
  "guide.features.languages.empty": "No language matches “{query}”",
  "guide.features.languages.loading": "Loading the list…",
  "guide.features.languages.error": "Couldn't load the list",
  "guide.features.languages.listLabel": "Supported languages",

  "guide.features.merge.title": "Conflict-free editing",
  "guide.features.merge.body1":
    "gachipad uses Yjs, a library for conflict-free replicated data. Edits made at the same time, on any device, merge the same way for everyone. Nobody overwrites anybody, and nobody has to resolve a conflict.",
  "guide.features.merge.body2":
    "Undo only takes back your own changes, never someone else's typing.",

  "guide.features.files.title": "Files and folders",
  "guide.features.files.body1":
    "A share holds up to {max} files. Put slashes in a file name to make folders, such as src/index.ts.",
  "guide.features.files.body2":
    "Drop files, a folder or a .zip anywhere onto the page, or use Upload files in the more menu. System leftovers such as .DS_Store, Thumbs.db and __MACOSX are skipped, and Windows paths and line endings are tidied.",
  "guide.features.files.more": "More on adding files and what is skipped",
  "guide.features.files.body3":
    "The administrator of each server sets the size limits. Here, one upload can be up to {upload} MB and the text of one share up to {doc} MB.",

  "guide.features.history.title": "History and restore",
  "guide.features.history.body1":
    "The owner can open the history from the top bar. Nobody else can, and deleted text in it is never sent to other people.",
  "guide.features.history.body2":
    "While people edit, gachipad saves a version about every {seconds} seconds, up to {max} per share. The administrator decides how many days they are kept, {days} by default.",
  "guide.features.history.body3":
    "Play the history back at 1x, 2x or 4x, or compare any version with the current text.",
  "guide.features.history.body4":
    "Restoring a version makes it the current text for everyone. It is added as a normal change, so the history is kept and you can restore another version later.",

  "guide.features.download.title": "Download",
  "guide.features.download.body":
    "Download one file with the extension that matches its language, or the whole share as a .zip that keeps the folders.",

  "guide.features.shortcuts.title": "Keyboard shortcuts",
  "guide.features.shortcuts.lead":
    "Shown for your device. Switch the platform to see the other keys.",
  "guide.features.shortcuts.platform": "Show keys for",
  "guide.features.shortcuts.mac": "Mac",
  "guide.features.shortcuts.windows": "Windows and Linux",
  "guide.features.shortcuts.caption": "Keyboard shortcuts",
  "guide.features.shortcuts.action": "Action",
  "guide.features.shortcuts.keys": "Keys",
  "guide.features.shortcuts.group.general": "In the app",
  "guide.features.shortcuts.group.editing": "Editing",
  "guide.features.shortcuts.group.navigation": "Moving around",
  "guide.features.shortcuts.note1":
    "Press ? outside a text field to see this list inside gachipad.",
  "guide.features.shortcuts.note2":
    "On a Mac the app shortcuts use Control and Command, because Command with Option belongs to the browser and macOS. On Windows and Linux they use Ctrl and Alt.",
  "guide.features.shortcuts.note3":
    "While an input method is composing text, shortcuts, Enter, Esc and Tab wait until the text is confirmed.",

  "guide.features.settings.title": "Editor settings",
  "guide.features.settings.lead":
    "Settings are kept in your browser, per device. Open them from the top bar or with",
  "guide.features.settings.theme.title": "App theme",
  "guide.features.settings.theme.body":
    "Match system, light or dark. The home page and these guides follow it too.",
  "guide.features.settings.editorTheme.title": "Editor theme",
  "guide.features.settings.editorTheme.body":
    "Slate and Graphite are dark, Paper and Sand are light. By default the editor follows the app theme: Slate in dark and Paper in light.",
  "guide.features.settings.font.title": "Font size",
  "guide.features.settings.font.body": "From {min} to {max} px. The default is {default} px.",
  "guide.features.settings.indent.title": "Indenting and wrapping",
  "guide.features.settings.indent.body":
    "A tab size of 2, 3, 4 or 8, spaces or tab characters for indenting, line wrapping and line numbers can each be switched on or off.",
  "guide.features.settings.keymap.title": "Key bindings",
  "guide.features.settings.keymap.body": "Default, Vim, Emacs or Sublime.",
  "guide.features.settings.smooth.title": "Smooth typing",
  "guide.features.settings.smooth.body":
    "The cursor glides while you type. It is on by default and stays still when your system asks for reduced motion.",
  "guide.features.settings.notify.title": "Invite notifications",
  "guide.features.settings.notify.body":
    "Show invites as system notifications while gachipad is in a background tab. It is off by default and needs the browser's permission.",
  "guide.features.settings.language.title": "Display language",
  "guide.features.settings.language.body":
    "Korean or English. Switch it on any page; the choice is kept in this browser.",

  "guide.features.cursors.title": "Other people's cursors",
  "guide.features.cursors.lead":
    "Choose how other people's cursors are shown, so a crowd does not clutter the page. Change it in Settings under Other people's cursors.",
  "guide.features.cursors.auto.title": "Auto (default)",
  "guide.features.cursors.auto.body":
    "With {busy} or more people in a file, selections fade and names appear only briefly. At {crowd} or more, cursors dim too and names stop appearing automatically. The presenter, the person you follow and the owner keep their names.",
  "guide.features.cursors.moving.title": "Names when moving",
  "guide.features.cursors.moving.body": "Names show when someone moves or types.",
  "guide.features.cursors.always.title": "Names always on",
  "guide.features.cursors.always.body": "Everyone's name is shown all the time.",
  "guide.features.cursors.carets.title": "Cursors only",
  "guide.features.cursors.carets.body": "Colored cursors without names.",
  "guide.features.cursors.hover":
    "In every mode, hovering a cursor shows its name, and hovering or focusing a person in the people list highlights their cursor.",

  "guide.features.lab.title": "Lab mode",
  "guide.features.lab.lead":
    "For teaching. An instructor starts a lab and gives out its 6-digit code. Each student who joins gets their own copy to work in.",
  "guide.features.lab.start.title": "Start a lab",
  "guide.features.lab.start.body":
    "Open /lab/new in the address bar and select Start lab. Students enter the lab code on the home page.",
  "guide.features.lab.grid.title": "See every student",
  "guide.features.lab.grid.body":
    "The instructor sees all students in a grid: online or offline, when each last changed their code, and a preview of it.",
  "guide.features.lab.help.title": "Help in place",
  "guide.features.lab.help.body":
    "Enlarge a student's tile, or open it and edit together with them.",
  "guide.features.lab.send.title": "Send an example",
  "guide.features.lab.send.body":
    "Pick one of your shares and send it to everyone. Each student receives a separate copy.",
  "guide.features.lab.lock.title": "Lock editing",
  "guide.features.lab.lock.body":
    "Lock editing for all students while you explain, and unlock it when you are done. They can still read their copy.",
  "guide.features.lab.note": "Lab mode shows and edits code. It doesn't run or grade it.",

  "guide.features.templates.title": "Templates",
  "guide.features.templates.body1":
    "Select Start from a template on the home page, or run New share from template in the command palette. Search by name or language, check the file list and the preview, then create the share.",
  "guide.features.templates.builtIn": "Built in",
  "guide.features.templates.body2":
    "The administrator can add templates of their own. They appear in a group of their own.",

  "guide.features.more.title": "Also included",
  "guide.features.more.palette.title": "Command palette",
  "guide.features.more.palette.body":
    "Press the shortcut to find actions, your shares and templates by typing.",
  "guide.features.more.shares.title": "My shares",
  "guide.features.more.shares.body":
    "Save shares to find them again. Give each one a folder and up to {tags} tags. Folders and tags are visible only to you.",
  "guide.features.more.format.title": "Format code",
  "guide.features.more.format.body": "Tidy a file with one shortcut.",
  "guide.features.more.secret.title": "Secret warning",
  "guide.features.more.secret.body":
    "If pasted text looks like an API key or a password, gachipad warns you first. The administrator can turn this off.",

  // ── Network ──
  "guide.network.title": "Faster on the same network",
  "guide.network.lead":
    "gachipad runs on a server in your network. Everyone on that network reaches it directly, and every way of joining builds on that.",
  "guide.network.toc.why": "Why it is quicker",
  "guide.network.toc.ways": "Five ways in",
  "guide.network.toc.groups": "Who counts as nearby",
  "guide.network.toc.address": "A short address",
  "guide.network.toc.size": "Large uploads",
  "guide.network.toc.offline": "No internet needed",

  "guide.network.why.title": "Why it is quicker",
  "guide.network.why.body1":
    "Joining usually means finding a link, copying it and pasting it into a message. In gachipad the people next to you are already on the same network as the server, so it can show them what is open and let you send it to them.",
  "guide.network.why.body2":
    "Your code is only exchanged with the server and with the other people in the share.",

  "guide.network.ways.title": "Five ways in",
  "guide.network.ways.caption": "Ways to join a share",
  "guide.network.ways.way": "Way",
  "guide.network.ways.how": "How it works",
  "guide.network.ways.who": "Who it reaches",
  "guide.network.ways.code.how": "Type the 6 digits, or add them to the address",
  "guide.network.ways.code.who": "Anyone who has the code",
  "guide.network.ways.qr.how": "Scan it from the Share window or a projected screen",
  "guide.network.ways.qr.who": "Anyone who can see the screen and is on the network",
  "guide.network.ways.nearby.how": "Pick the share from the list on the home page",
  "guide.network.ways.nearby.who":
    "People on the same network or in the same room, unless the share has a PIN or approval or the owner hid it",
  "guide.network.ways.send.how": "Pick a name, and an invite appears on that screen",
  "guide.network.ways.send.who": "One person who has gachipad open",
  "guide.network.ways.room.how": "Press one button, then confirm",
  "guide.network.ways.room.who": "Everyone in the room, or on the network if there are no rooms",

  "guide.network.groups.title": "Who counts as nearby",
  "guide.network.groups.body1":
    "Nearby shares, sending and showing to the room all work on groups of devices. By default a group is everyone in the same network range: the same /24 for IPv4. The administrator can change the prefix length.",
  "guide.network.groups.body2":
    "The administrator can also define rooms, such as classrooms, from address ranges. People in a room see only that room's shares, and showing a share to the room reaches only that room.",
  "guide.network.groups.body3":
    "Owners decide for each share whether it is listed, and shares with a PIN or approval never are. A nearby card shows the title and the first {lines} lines of the code.",
  "guide.network.groups.body4": "The administrator can also make new shares unlisted by default.",

  "guide.network.address.title": "A short address",
  "guide.network.address.body1":
    "People need the server's address once. The Share window shows it next to the join code, and the QR code saves typing it.",
  "guide.network.address.body2":
    "If the administrator has switched on the optional name service, the server also answers to gachipad.local on networks that support mDNS, so there is nothing to remember. Otherwise people use the server's regular address.",

  "guide.network.size.title": "Large uploads",
  "guide.network.size.body1":
    "Drop files, a folder or a .zip onto the page, or pick them with the upload button. They go to the server on your network and not out to the internet, so an upload takes as long as your network needs.",
  "guide.network.size.body2":
    "The administrator sets the limit for one upload, {upload} MB by default, and the size of the text in one share, 5 MB by default.",
  "guide.network.size.body3":
    "You can also send files straight to a person: drop them on a name in the Share window, and they get a notification with a button to open them.",

  "guide.network.offline.title": "No internet needed",
  "guide.network.offline.body1":
    "Scripts, fonts and icons all come from the same server. Devices only need a connection to it, so gachipad works on a network that is cut off from the internet.",
  "guide.network.offline.body2":
    "Unless the administrator turns it off, the server looks for new releases by itself, and a sign-in provider (OIDC or LDAP) may be involved if one is set up. Both are explained under Privacy.",
  "guide.network.offline.link": "What the server may contact",

  // ── Privacy and safety ──
  "guide.security.title": "Privacy and safety",
  "guide.security.lead":
    "What gachipad keeps, for how long, who can see it, and what you can remove.",
  "guide.security.toc.stored": "What is stored",
  "guide.security.toc.deleted": "Deleted text",
  "guide.security.toc.history": "History",
  "guide.security.toc.device": "Copies on your device",
  "guide.security.toc.external": "No outside requests",
  "guide.security.toc.controls": "What administrators control",
  "guide.security.toc.host": "Run it yourself",

  "guide.security.stored.title": "What is stored on the server",
  "guide.security.stored.contents.title": "Share contents",
  "guide.security.stored.contents.body":
    "The current text of every file, with titles and file names. Versions for the history are stored separately.",
  "guide.security.stored.people.title": "Names and colors",
  "guide.security.stored.people.body":
    "The display name and color you pick. There are no passwords or accounts unless the administrator turns on sign-in.",
  "guide.security.stored.access.title": "Codes and access",
  "guide.security.stored.access.body":
    "Join codes, the people an owner blocked, and a hash of each PIN. The PIN itself is not stored.",
  "guide.security.stored.audit.title": "Audit log",
  "guide.security.stored.audit.body":
    "Off by default. If the administrator turns it on, it records who creates, opens, downloads and deletes shares, and entries are removed after the retention period, 90 days by default.",
  "guide.security.stored.how": "How long it is kept",
  "guide.security.stored.save": "Saved shares don't expire.",
  "guide.security.stored.code":
    "A join code lasts as long as its share. A code that was released isn't given out again for 24 hours.",

  "guide.security.deleted.title": "Deleted text is not sent to others",
  "guide.security.deleted.body1":
    "People who join a share receive its current text. Text that was typed and then deleted is not part of what they receive.",
  "guide.security.deleted.body2":
    "Someone who was in the share while you typed saw that text as you typed it. Nobody who joins later gets it.",

  "guide.security.history.title": "History is for the owner",
  "guide.security.history.body1":
    "Versions of the share are saved on the server so the owner can play them back and restore them. Only the owner can open the history.",
  "guide.security.history.body2":
    "Versions are removed after the retention period, and the deleted text they contain goes with them.",

  "guide.security.device.title": "Copies on your device",
  "guide.security.device.body1":
    "To keep your changes through a lost connection, gachipad can store an offline copy of a share in this browser. It asks the first time you open the editor, and nothing is saved before you agree.",
  "guide.security.device.body2":
    "On a shared computer, choose Not on this device, or use a separate browser profile.",
  "guide.security.device.remove": "To remove copies",
  "guide.security.device.forget.title": "Forget on this device",
  "guide.security.device.forget.body":
    "In the editor settings. It closes the share in every tab of this browser and deletes its copy and saved edit key. The share stays on the server.",
  "guide.security.device.off.title": "Turn copies off",
  "guide.security.device.off.body":
    "Turning offline copies off in the settings deletes every copy.",
  "guide.security.device.signOut.title": "Sign out, forget all",
  "guide.security.device.signOut.body":
    "Shown when you are signed in. It signs you out and deletes every copy and edit key in this browser.",
  "guide.security.device.auto.title": "Automatically",
  "guide.security.device.auto.body":
    "A copy is deleted when you are removed or blocked, or when the share is deleted or expires. Shares with a PIN or approval load their copy only after you are let in again.",
  "guide.security.device.body3":
    "The server can't reach a browser that never comes back. If gachipad says some copies might remain, clear this site's data in the browser settings.",

  "guide.security.external.title": "No outside requests",
  "guide.security.external.body1":
    "Pages, scripts, fonts, icons and images all come from your gachipad server. There are no analytics, ads, trackers or content delivery networks. With the default settings your browser contacts nothing but the gachipad server.",
  "guide.security.external.body2":
    "Two things depend on what the administrator sets up. If sign-in uses an identity provider (OIDC), your browser is sent to that provider to sign in; with LDAP, the server checks the sign-in against the directory server. The other exception happens on the server: unless the administrator turns it off, it sends a plain request to GitHub about every 12 hours to see whether a new version exists. It carries no share content and fails quietly without internet.",
  "guide.security.external.body3":
    "Edit links keep their key after the # sign, which browsers don't send with page requests, so it stays out of server logs and addresses. gachipad sends it once, in the join request, to check it. PINs are stored only as hashes.",

  "guide.security.controls.title": "What administrators control",
  "guide.security.controls.lead": "These are set by the administrator of this server.",
  "guide.security.controls.lifetime": "How long unsaved shares last",
  "guide.security.controls.history": "How long history is kept",
  "guide.security.controls.sizes": "The size of a share and of an upload",
  "guide.security.controls.guests": "Whether guests are allowed, and sign-in with OIDC or LDAP",
  "guide.security.controls.rooms": "Rooms, and whether new shares are listed as nearby",
  "guide.security.controls.audit": "The audit log and how long it is kept",
  "guide.security.controls.secrets": "The warning about pasted keys and passwords",
  "guide.security.controls.templates": "Templates and the contact shown in the footer",
  "guide.security.controls.note":
    "Whoever runs the server and its database can reach what is stored there. Use a PIN or approval for what not everyone on the network should see, and ask your administrator about the rules on this server.",

  "guide.security.host.title": "Run it yourself",
  "guide.security.host.body1":
    "gachipad is open source under the MIT license. It runs on your own server with Docker Compose: a web server, the API, the editing service, MongoDB and Valkey. An optional service adds the gachipad.local name.",
  "guide.security.host.body2":
    "Nothing depends on an outside service, and each release comes with an offline bundle for networks without internet.",

  // ── Questions ──
  "guide.faq.title": "Questions",
  "guide.faq.lead": "Short answers, grouped by topic. Select a question to open it.",
  "guide.faq.group.start": "Getting started",
  "guide.faq.group.people": "Joining and access",
  "guide.faq.group.edit": "Editing",
  "guide.faq.group.network": "Network and privacy",
  "guide.faq.account.q": "Do I need an account?",
  "guide.faq.account.a":
    "No. Pick a name and start. If the administrator turned on sign-in you can sign in, and guests can still use gachipad unless guests are turned off.",
  "guide.faq.run.q": "Can I run code in gachipad?",
  "guide.faq.run.a": "No. gachipad shares and edits text. It doesn't run code.",
  "guide.faq.cantEdit.q": "Why can't I edit?",
  "guide.faq.cantEdit.a":
    "The owner may have set the share to view only, or locked editing for a while. Ask the owner for the edit link, or to unlock editing.",
  "guide.faq.pin.q": "I forgot the PIN",
  "guide.faq.pin.a":
    "Only the owner can help. They can see the share, set a new PIN and give it to you. After several wrong tries you have to wait a few minutes.",
  "guide.faq.notNearby.q": "Why isn't my share listed as nearby?",
  "guide.faq.notNearby.a":
    "A share with a PIN or approval is never listed, and the owner can hide a share. Only people on the same network or in the same room see it.",
  "guide.faq.codeFails.q": "The code doesn't work",
  "guide.faq.codeFails.a":
    "Check the 6 digits. If the share expired or was deleted, its code stops working, and a released code isn't reused for 24 hours. Ask for a new code.",
  "guide.faq.offline.q": "What if I lose the connection?",
  "guide.faq.offline.a":
    "Keep typing. Your changes are kept and merge when the connection returns. If you chose not to keep offline copies, they are held only in the open tab, so don't close it.",
  "guide.faq.size.q": "How big can a share be?",
  "guide.faq.size.a":
    "The administrator sets the limits. By default a share's text can be 5 MB and one upload {upload} MB.",
  "guide.faq.folder.q": "Can I upload a folder?",
  "guide.faq.folder.a":
    "Yes. Drop files, a folder or a .zip anywhere onto the page, or use Upload files in the more menu. A share holds up to {max} files.",
  "guide.faq.duplicate.q": "What if a file with the same name is uploaded?",
  "guide.faq.duplicate.a":
    "If the name and the content are both the same, the existing file opens. If only the name is the same, the new one is added as main (2).py and the existing file is never overwritten.",
  "guide.faq.uploadFails.q": "My files won't upload",
  "guide.faq.uploadFails.a":
    "First check that you may add files: viewers cannot, and neither can editors unless the owner allowed it. Then read the notice for the reason. Files that are not text, files over {perFile} MB, more than {max} files at once and files over the size limit are skipped. If dragging does not work, try Upload files in the more menu.",
  "guide.faq.cursors.q": "Other people's cursors are distracting",
  "guide.faq.cursors.a":
    "In Settings, change Other people's cursors. You can show cursors without names, or names only while someone is moving. With many people in one file, the default Auto already quiets them for you.",
  "guide.faq.history.q": "Who can see the history?",
  "guide.faq.history.a":
    "Only the owner. Deleted text in it is never sent to other people, and old versions are removed after the retention period.",
  "guide.faq.internet.q": "Does it need the internet?",
  "guide.faq.internet.a":
    "No. Everything comes from the server on your network. The server itself may check for new releases unless the administrator turns that off.",
  "guide.faq.tracking.q": "Does it track me?",
  "guide.faq.tracking.a":
    "There are no analytics, ads or trackers, and with the default settings the browser contacts only the gachipad server (a sign-in provider, if the administrator set one up, is the exception). If the administrator turned on the audit log, it records who creates, opens, downloads and deletes shares.",
  "guide.faq.shared.q": "How do I leave nothing behind on a shared computer?",
  "guide.faq.shared.a":
    "Answer Not on this device when gachipad asks about offline copies, or use Forget on this device in the editor settings when you are done.",
  "guide.faq.contact.q": "Who do I ask about this server?",
  "guide.faq.contact.a":
    "The footer shows a contact when the administrator has set one. Rules such as expiry and size limits are theirs to answer.",
} as const satisfies Record<string, string>;

export type GuideKey = keyof typeof guideEn;
