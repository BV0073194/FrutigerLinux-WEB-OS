export function init(body) {
  const downloadBtn = body.querySelector("#downloadOsBtn");
  const statusElement = body.querySelector("#osStatus");
  
  if (downloadBtn && statusElement) {
    downloadBtn.addEventListener("click", async () => {
      statusElement.textContent = "Downloading...";
      
      try {
        const res = await fetch("/apps/os");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = "FrutigerAeroOS.exe";
        a.click();

        URL.revokeObjectURL(url);
        statusElement.textContent = "Downloaded!";
        
        setTimeout(() => {
          statusElement.textContent = "Ready";
        }, 3000);
      } catch (err) {
        statusElement.textContent = "Download failed!";
        console.error("OS download error:", err);
      }
    });
  }
}