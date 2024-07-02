document.addEventListener("DOMContentLoaded", () => {
    const copyButtons = document.querySelectorAll(".copy-button");
    const ipElements = document.querySelectorAll(".ip");

    copyButtons.forEach(button => {
        button.addEventListener("click", (event) => {
            const visitorId = event.target.closest(".ip").getAttribute("data-visitor-id");
            navigator.clipboard.writeText(visitorId).then(() => {
                // ok
            });
        });
    });

    ipElements.forEach(ipElement => {
        ipElement.addEventListener("mouseenter", async (event) => {
            const popout = event.target.querySelector(".popout");
            const ip = event.target.getAttribute("data-ip");
            if (!popout.classList.contains("loaded")) {
                const response = await fetch("ipinfo", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ ip })
                });

                if (response.ok) {
                    try {
                        const data = await response.json();
                        popout.querySelector(".country-code").textContent = data.countryCode;
                        popout.querySelector(".vpn").textContent = data.vpn ? "Yes" : "No";
                    } catch {
                        // something went wrong... no idea what
                        popout.querySelector(".country-code").textContent = "N/A";
                        popout.querySelector(".vpn").textContent = "N/A";
                    }
                } else {
                    // no existing data.
                    popout.querySelector(".country-code").textContent = "N/A";
                    popout.querySelector(".vpn").textContent = "N/A";
                }

                popout.setAttribute("data-loaded", "true");
            }
        });
    });
});
