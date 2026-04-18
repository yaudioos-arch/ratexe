const socket = io();
const nicknameInput = document.getElementById("nicknameInput");
const topicSelect = document.getElementById("topicSelect");
const startButton = document.getElementById("startButton");
const nextButton = document.getElementById("nextButton");
const leaveButton = document.getElementById("leaveButton");
const clearButton = document.getElementById("clearButton");
const themeButton = document.getElementById("themeButton");
const partnerLabel = document.getElementById("partnerLabel");
const fileInput = document.getElementById("fileInput");
const sendFileButton = document.getElementById("sendFileButton");
const recordButton = document.getElementById("recordButton");
const sendVoiceButton = document.getElementById("sendVoiceButton");
const voiceStatus = document.getElementById("voiceStatus");
const gifSearchInput = document.getElementById("gifSearchInput");
const gifSearchButton = document.getElementById("gifSearchButton");
const gifToggleButton = document.getElementById("gifToggleButton");
const gifResults = document.getElementById("gifResults");
const sendButton = document.getElementById("sendButton");
const statusEl = document.getElementById("status");
const messagesEl = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const typingIndicator = document.getElementById("typingIndicator");

let connected = false;
let waiting = false;
let typingTimeout = null;
let mediaRecorder = null;
let recordedChunks = [];
let voiceBlob = null;
let myNickname = "Guest";
let partnerName = "Stranger";
let gifPanelOpen = true;
let currentTheme = localStorage.getItem("ratexeTheme") || "dark";

function formatTimestamp(value) {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function addMessage(text, author = "Stranger", isYou = false, timestamp = Date.now(), options = {}) {
  const messageEl = document.createElement("div");
  messageEl.className = `message${isYou ? " you" : ""}`;
  messageEl.innerHTML = `
    <span class="author">${author}</span>
    <span class="timestamp">${formatTimestamp(timestamp)}</span>
    <span class="content"></span>
  `;

  const content = messageEl.querySelector(".content");
  if (options.file) {
    const { name, type, url, size } = options.file;
    if (type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = name;
      img.className = "shared-image";
      content.appendChild(img);
    } else if (type.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.src = url;
      audio.controls = true;
      audio.className = "shared-audio";
      content.appendChild(audio);
    }
    const downloadLink = document.createElement("a");
    downloadLink.href = url;
    downloadLink.download = name;
    downloadLink.textContent = `Download ${name} (${Math.round(size / 1024)} KB)`;
    content.appendChild(downloadLink);
  } else if (options.gifUrl) {
    const img = document.createElement("img");
    img.src = options.gifUrl;
    img.alt = "GIF";
    img.className = "shared-gif";
    content.appendChild(img);
    if (text) {
      const caption = document.createElement("div");
      caption.textContent = text;
      content.appendChild(caption);
    }
  } else {
    content.textContent = text;
  }

  messagesEl.appendChild(messageEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function updateControls() {
  messageInput.disabled = !connected;
  sendButton.disabled = !connected;
  sendFileButton.disabled = !connected || !fileInput.files.length;
  recordButton.disabled = !connected;
  sendVoiceButton.disabled = !connected || !voiceBlob;
  leaveButton.disabled = !(connected || waiting);
  nextButton.disabled = !connected;
  startButton.disabled = connected || waiting;
  nicknameInput.disabled = connected || waiting;
  topicSelect.disabled = connected || waiting;
  if (!connected) {
    messageInput.value = "";
    partnerName = "Stranger";
  }
  partnerLabel.textContent = `Partner: ${connected ? partnerName : "—"}`;
}

const TENOR_KEY = "LIVDSRZULELA";

function applyTheme(theme) {
  document.documentElement.classList.toggle("light-mode", theme === "light");
  themeButton.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
  currentTheme = theme;
  localStorage.setItem("ratexeTheme", theme);
}

function addFileMessage(file, author = "Stranger", isYou = false) {
  const blob = new Blob([file.data], { type: file.type });
  const url = URL.createObjectURL(blob);
  addMessage(file.name, author, isYou, file.timestamp || Date.now(), {
    file: {
      ...file,
      url,
    },
  });
}

async function searchGifs(query) {
  if (!query) return;
  gifResults.innerHTML = "<div class='loading'>Searching GIFs...</div>";
  try {
    const response = await fetch(
      `https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${TENOR_KEY}&limit=8`
    );
    const data = await response.json();
    gifResults.innerHTML = "";
    data.results.forEach((item) => {
      const media = item.media?.[0];
      const url = media?.gif?.url || media?.tinygif?.url;
      const thumb = media?.tinygif?.url;
      if (!url || !thumb) return;
      const button = document.createElement("button");
      button.className = "gif-thumb";
      button.type = "button";
      button.dataset.url = url;
      button.innerHTML = `<img src="${thumb}" alt="GIF" />`;
      gifResults.appendChild(button);
    });
  } catch (error) {
    gifResults.innerHTML = "<div class='error'>Unable to load GIFs.</div>";
    console.error(error);
  }
}

function sendFile() {
  const file = fileInput.files[0];
  if (!connected || !file) return;
  file.arrayBuffer().then((buffer) => {
    const payload = {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      data: buffer,
      timestamp: Date.now(),
    };
    socket.emit("file", payload);
    addFileMessage(payload, myNickname || "You", true);
    fileInput.value = "";
    sendFileButton.disabled = true;
  });
}

function setGifPanelOpen(open) {
  gifPanelOpen = open;
  gifToggleButton.textContent = open ? "Hide GIFs" : "Show GIFs";
  gifResults.parentElement.classList.toggle("collapsed", !open);
}

function sendGif(gifUrl) {
  if (!connected || !gifUrl) return;
  const payload = {
    text: "Shared a GIF",
    gifUrl,
    timestamp: Date.now(),
  };
  socket.emit("message", payload);
  addMessage("Sent a GIF", myNickname || "You", true, Date.now(), { gifUrl });
  setGifPanelOpen(false);
}

function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    voiceStatus.textContent = "Voice recording is not supported in this browser.";
    return;
  }

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      mediaRecorder = new MediaRecorder(stream);
      recordedChunks = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
      };
      mediaRecorder.onstop = () => {
        voiceBlob = new Blob(recordedChunks, { type: "audio/webm" });
        voiceStatus.textContent = `Voice message ready (${Math.round(voiceBlob.size / 1024)} KB)`;
        sendVoiceButton.disabled = !connected || !voiceBlob;
        recordButton.textContent = "Start Recording";
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorder.start();
      voiceStatus.textContent = "Recording...";
      recordButton.textContent = "Stop Recording";
      sendVoiceButton.disabled = true;
    })
    .catch((error) => {
      console.error(error);
      voiceStatus.textContent = "Unable to access microphone.";
    });
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
}

function sendVoice() {
  if (!connected || !voiceBlob) return;
  const reader = new FileReader();
  reader.onload = () => {
    const arrayBuffer = reader.result;
    const payload = {
      name: `voice-${Date.now()}.webm`,
      type: voiceBlob.type,
      size: voiceBlob.size,
      data: arrayBuffer,
      timestamp: Date.now(),
    };
    socket.emit("file", payload);
    addFileMessage(payload, myNickname || "You", true);
    voiceBlob = null;
    sendVoiceButton.disabled = true;
    voiceStatus.textContent = "Voice message sent.";
  };
  reader.readAsArrayBuffer(voiceBlob);
}

function sendTyping() {
  if (!connected) return;
  socket.emit("typing");
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit("stopTyping");
  }, 800);
}

function getNickname() {
  const raw = nicknameInput.value.trim();
  return raw || `Guest${Math.floor(Math.random() * 9000 + 1000)}`;
}

startButton.addEventListener("click", () => {
  myNickname = getNickname();
  socket.emit("findPartner", { nickname: myNickname, topic: topicSelect.value });
  setStatus("Searching for a stranger...");
  connected = false;
  waiting = true;
  updateControls();
});

nextButton.addEventListener("click", () => {
  socket.emit("leave");
  socket.emit("findPartner", { nickname: myNickname, topic: topicSelect.value });
  setStatus("Looking for your next stranger...");
  connected = false;
  waiting = true;
  updateControls();
});

leaveButton.addEventListener("click", () => {
  socket.emit("leave");
  setStatus("Left the chat.");
  addMessage("You left the chat.", "System");
  connected = false;
  waiting = false;
  updateControls();
});

clearButton.addEventListener("click", () => {
  messagesEl.innerHTML = "";
  typingIndicator.textContent = "";
  addMessage("Chat cleared.", "System");
});

themeButton.addEventListener("click", () => {
  applyTheme(currentTheme === "dark" ? "light" : "dark");
});

fileInput.addEventListener("change", () => {
  sendFileButton.disabled = !connected || !fileInput.files.length;
});

sendFileButton.addEventListener("click", sendFile);
recordButton.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    stopRecording();
  } else {
    startRecording();
  }
});

sendVoiceButton.addEventListener("click", sendVoice);

gifSearchButton.addEventListener("click", () => {
  const query = gifSearchInput.value.trim();
  if (!gifPanelOpen) setGifPanelOpen(true);
  searchGifs(query || "funny");
});

gifToggleButton.addEventListener("click", () => {
  setGifPanelOpen(!gifPanelOpen);
});

gifResults.addEventListener("click", (event) => {
  const button = event.target.closest(".gif-thumb");
  if (!button || !connected) return;
  sendGif(button.dataset.url);
});

sendButton.addEventListener("click", () => {
  const text = messageInput.value.trim();
  if (!text) return;
  addMessage(text, myNickname || "You", true);
  socket.emit("message", text);
  messageInput.value = "";
  socket.emit("stopTyping");
});

messageInput.addEventListener("input", () => {
  if (connected) {
    sendTyping();
  }
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendButton.click();
  }
});

socket.on("waiting", ({ topic }) => {
  waiting = true;
  connected = false;
  setStatus(`Waiting for a partner who likes ${topic}...`);
  addMessage(`Searching for a stranger interested in ${topic}.`, "System");
  updateControls();
});

socket.on("partnerFound", ({ topic, partnerName: name }) => {
  connected = true;
  waiting = false;
  partnerName = name || "Stranger";
  setStatus(`Connected! You are now chatting about ${topic}.`);
  addMessage(`Matched with ${partnerName} who likes ${topic}. Say hello!`, "System");
  updateControls();
});

socket.on("message", (message) => {
  const incoming = typeof message === "string"
    ? { text: message, author: "Stranger", timestamp: Date.now() }
    : message;
  addMessage(
    incoming.text || "",
    incoming.author || "Stranger",
    false,
    incoming.timestamp,
    { gifUrl: incoming.gifUrl }
  );
});

socket.on("file", (fileData) => {
  addFileMessage(fileData, fileData.author || "Stranger", false);
});

socket.on("typing", () => {
  typingIndicator.textContent = "Stranger is typing...";
});

socket.on("stopTyping", () => {
  typingIndicator.textContent = "";
});

socket.on("partnerDisconnected", () => {
  addMessage("Your partner disconnected.", "System");
  setStatus("Partner disconnected. Start again to find a new stranger.");
  connected = false;
  waiting = false;
  updateControls();
});

applyTheme(currentTheme);
setGifPanelOpen(true);
updateControls();

