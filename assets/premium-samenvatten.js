(function () {
    "use strict";

    const fileInput = document.getElementById("audioFileInput");
    const dropzone = document.getElementById("audioDropzone");
    const selectedAudio = document.getElementById("selectedAudio");
    const selectedAudioName = document.getElementById("selectedAudioName");
    const selectedAudioMeta = document.getElementById("selectedAudioMeta");
    const removeAudioButton = document.getElementById("removeAudioButton");
    const summarizeButton = document.getElementById("summarizeButton");
    const summarizeStatus = document.getElementById("summarizeStatus");

    if (!fileInput || !dropzone || !selectedAudio || !summarizeButton) return;

    function formatFileSize(bytes) {
        const size = Number(bytes) || 0;
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }

    function setSelectedFile(file) {
        const hasFile = Boolean(file);
        selectedAudio.hidden = !hasFile;
        summarizeButton.disabled = !hasFile;
        summarizeStatus.textContent = "";

        if (!hasFile) {
            selectedAudioName.textContent = "";
            selectedAudioMeta.textContent = "";
            fileInput.value = "";
            return;
        }

        selectedAudioName.textContent = String(file.name || "Audiobestand");
        selectedAudioMeta.textContent = `${formatFileSize(file.size)} · klaar voor samenvatten`;
    }

    fileInput.addEventListener("change", function () {
        setSelectedFile(fileInput.files && fileInput.files[0]);
    });

    dropzone.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        fileInput.click();
    });

    ["dragenter", "dragover"].forEach(function (eventName) {
        dropzone.addEventListener(eventName, function (event) {
            event.preventDefault();
            dropzone.classList.add("is-dragging");
        });
    });

    ["dragleave", "drop"].forEach(function (eventName) {
        dropzone.addEventListener(eventName, function (event) {
            event.preventDefault();
            dropzone.classList.remove("is-dragging");
        });
    });

    dropzone.addEventListener("drop", function (event) {
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        setSelectedFile(file);
    });

    removeAudioButton.addEventListener("click", function () {
        setSelectedFile(null);
    });

    summarizeButton.addEventListener("click", function () {
        summarizeStatus.textContent = "De interface staat klaar; de samenvattingsfunctie wordt later gekoppeld.";
    });
})();
