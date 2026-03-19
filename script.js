const menuToggle = document.getElementById("menuToggle");
const mainNav = document.getElementById("mainNav");
const themeToggle = document.getElementById("themeToggle");
const quickQueryLinks = document.querySelectorAll('[data-query="quick"], [data-whatsapp="quick"]');
const packageQueryLinks = document.querySelectorAll('[data-query="package"], [data-whatsapp="package"]');
const queryForm = document.getElementById("queryForm") || document.getElementById("whatsappForm");
const contactSection = document.getElementById("contact");
const contactNameInput = document.getElementById("name");
const contactEmailInput = document.getElementById("email");
const contactServiceInput = document.getElementById("service");
const contactBudgetInput = document.getElementById("budget");
const contactDetailsInput = document.getElementById("details");
const contactSubmitButton = queryForm ? queryForm.querySelector('button[type="submit"]') : null;
const submitButtonDefaultText = contactSubmitButton
    ? (contactSubmitButton.textContent || "Submit Query").trim()
    : "Submit Query";
const filterButtons = document.querySelectorAll(".filter-btn");
const portfolioItems = document.querySelectorAll(".project-card");
const revealElements = document.querySelectorAll(".reveal");

const scrollProgress = document.getElementById("scrollProgress");
const backToTop = document.getElementById("backToTop");
const navSectionLinks = document.querySelectorAll('.main-nav a[href^="#"]:not([href="#"])');

const liveStatusCard = document.getElementById("liveStatusCard");
const liveStatusText = document.getElementById("liveStatusText");
const liveTime = document.getElementById("liveTime");
const liveWindow = document.getElementById("liveWindow");
const liveProjects = document.getElementById("liveProjects");
const liveQueue = document.getElementById("liveQueue");
const deployVersionElement = document.getElementById("deployVersion");

const estimatorForm = document.getElementById("estimatorForm");
const estService = document.getElementById("estService");
const estDelivery = document.getElementById("estDelivery");
const estRevisions = document.getElementById("estRevisions");
const estQuantity = document.getElementById("estQuantity");
const estAssets = document.getElementById("estAssets");
const revCount = document.getElementById("revCount");
const estimateAmount = document.getElementById("estimateAmount");
const estimateBreakdown = document.getElementById("estimateBreakdown");
const estimateMeta = document.getElementById("estimateMeta");
const sendEstimateBtn = document.getElementById("sendEstimateBtn");
const customContentMount = document.getElementById("customContentMount");
const customSection = document.getElementById("custom");
const customNavLink = document.querySelector('.main-nav a[href="#custom"]');

let latestEstimate = null;
let localStatusTimer = null;
let customContentWatchTimer = null;
let lastCustomContentHtml = "";
let customAccessAllowed = null;
let queryToastTimer = null;

const THEME_STORAGE_KEY = "designer-theme";
const LEAD_API_ENDPOINT = "/api/leads";
const CUSTOM_CONTENT_ENDPOINT = "/custom-content.html";
const CUSTOM_ACCESS_ENDPOINT = "/api/custom-access";
const CUSTOM_DEVICE_TOKEN_STORAGE_KEY = "custom-device-token";
const systemThemeQuery = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null;

let followSystemTheme = false;
let customDeviceToken = "";

if (customSection) {
    customSection.hidden = true;
}

if (customNavLink) {
    customNavLink.style.display = "none";
}

function setCustomSectionVisible(isVisible) {
    if (customSection) {
        customSection.hidden = !isVisible;
    }

    if (customNavLink) {
        if (isVisible) {
            customNavLink.style.removeProperty("display");
        } else {
            customNavLink.style.display = "none";
        }
    }
}

async function resolveCustomSectionAccess() {
    if (!customContentMount) return false;

    if (customAccessAllowed !== null) {
        return customAccessAllowed;
    }

    if (window.location.protocol === "file:") {
        customAccessAllowed = false;
        return customAccessAllowed;
    }

    try {
        const token = getOrCreateCustomDeviceToken();
        const response = await fetch(`${CUSTOM_ACCESS_ENDPOINT}?v=${Date.now()}`, {
            headers: {
                "x-custom-device-token": token
            },
            cache: "no-store"
        });

        if (!response.ok) {
            customAccessAllowed = false;
            return customAccessAllowed;
        }

        const data = await response.json();
        customAccessAllowed = Boolean(data?.allowed);
        return customAccessAllowed;
    } catch (error) {
        customAccessAllowed = false;
        return customAccessAllowed;
    }
}

function createCustomDeviceToken() {
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
        const bytes = new Uint8Array(24);
        window.crypto.getRandomValues(bytes);
        const randomPart = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
        return `cdt_${randomPart}`;
    }

    const chunk = () => Math.random().toString(36).slice(2, 12);
    return `cdt_${Date.now().toString(36)}_${chunk()}${chunk()}`;
}

function getOrCreateCustomDeviceToken() {
    if (customDeviceToken) {
        return customDeviceToken;
    }

    const tokenPattern = /^[a-zA-Z0-9_-]{16,220}$/;

    try {
        const existing = String(localStorage.getItem(CUSTOM_DEVICE_TOKEN_STORAGE_KEY) || "").trim();
        if (tokenPattern.test(existing)) {
            customDeviceToken = existing;
            return customDeviceToken;
        }

        const generatedToken = createCustomDeviceToken();
        localStorage.setItem(CUSTOM_DEVICE_TOKEN_STORAGE_KEY, generatedToken);
        customDeviceToken = generatedToken;
        return customDeviceToken;
    } catch (error) {
        customDeviceToken = createCustomDeviceToken();
        return customDeviceToken;
    }
}

function formatCurrencyINR(value) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0
    }).format(value);
}

function formatDeployTimestamp(value) {
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    }).format(parsedDate);
}

async function loadDeployVersionBadge() {
    if (!deployVersionElement) return;

    if (window.location.protocol === "file:") {
        deployVersionElement.textContent = "Build: local preview";
        deployVersionElement.removeAttribute("title");
        return;
    }

    deployVersionElement.textContent = "Build: checking...";

    try {
        const response = await fetch(`/api/version?v=${Date.now()}`, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`Version endpoint failed: ${response.status}`);
        }

        const payload = await response.json();
        const version = String(payload?.version || "").trim() || "unknown";
        const commit = String(payload?.commit || "").trim();
        const branch = String(payload?.branch || "").trim();
        const bootedAt = formatDeployTimestamp(payload?.bootedAt);

        const badgeParts = [`Build: v${version}`];
        if (commit) {
            badgeParts.push(`commit ${commit}`);
        }
        if (bootedAt) {
            badgeParts.push(`boot ${bootedAt}`);
        }

        deployVersionElement.textContent = badgeParts.join(" • ");

        const tooltipParts = [
            branch ? `Branch: ${branch}` : "",
            payload?.buildTag ? `Tag: ${payload.buildTag}` : ""
        ].filter(Boolean);

        if (tooltipParts.length) {
            deployVersionElement.title = tooltipParts.join(" | ");
        } else {
            deployVersionElement.removeAttribute("title");
        }
    } catch (error) {
        deployVersionElement.textContent = "Build: unavailable";
        deployVersionElement.removeAttribute("title");
    }
}

function ensureQueryToastElement() {
    const existingToast = document.getElementById("queryToast");
    if (existingToast) {
        return existingToast;
    }

    const toast = document.createElement("div");
    toast.id = "queryToast";
    toast.className = "query-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
    return toast;
}

function triggerQueryFormAnimation(type = "pulse") {
    if (!queryForm) return;

    const animationClasses = ["query-submit-pulse", "query-submit-success", "query-submit-error"];
    queryForm.classList.remove(...animationClasses);
    void queryForm.offsetWidth;

    if (type === "success") {
        queryForm.classList.add("query-submit-success");
        return;
    }

    if (type === "error") {
        queryForm.classList.add("query-submit-error");
        return;
    }

    queryForm.classList.add("query-submit-pulse");
}

function setQueryFormSubmittingState(isSubmitting) {
    if (!queryForm) return;

    queryForm.classList.toggle("query-submitting", Boolean(isSubmitting));

    if (!contactSubmitButton) return;

    contactSubmitButton.disabled = Boolean(isSubmitting);
    contactSubmitButton.classList.toggle("is-loading", Boolean(isSubmitting));
    contactSubmitButton.textContent = isSubmitting ? "Submitting..." : submitButtonDefaultText;
}

function showQuerySubmitMessage(message, tone = "info") {
    const toast = ensureQueryToastElement();
    const safeTone = ["success", "error", "info"].includes(tone) ? tone : "info";

    toast.textContent = String(message || "").trim();
    toast.classList.remove("success", "error", "info", "show");
    toast.classList.add(safeTone);

    window.requestAnimationFrame(() => {
        toast.classList.add("show");
    });

    if (queryToastTimer) {
        clearTimeout(queryToastTimer);
    }

    queryToastTimer = window.setTimeout(() => {
        toast.classList.remove("show");
    }, 2600);
}

function getBudgetRangeFromAmount(amount) {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return "";

    if (numericAmount <= 5000) return "Under ₹5,000";
    if (numericAmount <= 15000) return "₹5,000 - ₹15,000";
    if (numericAmount <= 30000) return "₹15,000 - ₹30,000";
    return "₹30,000+";
}

function mapPackagePriceToBudget(packagePrice) {
    const numericAmount = Number(String(packagePrice || "").replace(/[^0-9]/g, ""));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return "";
    return getBudgetRangeFromAmount(numericAmount);
}

function prefillContactFormAndFocus({ service = "", budget = "", details = "" } = {}) {
    if (contactServiceInput && service) {
        const hasMatchingService = [...contactServiceInput.options].some((option) => option.value === service);
        if (hasMatchingService) {
            contactServiceInput.value = service;
        }
    }

    if (contactBudgetInput && budget) {
        const hasMatchingBudget = [...contactBudgetInput.options].some((option) => option.value === budget);
        if (hasMatchingBudget) {
            contactBudgetInput.value = budget;
        }
    }

    if (contactDetailsInput && details) {
        const normalizedDetails = String(details).trim();
        const existingDetails = contactDetailsInput.value.trim();

        if (!existingDetails) {
            contactDetailsInput.value = normalizedDetails;
        } else if (!existingDetails.includes(normalizedDetails)) {
            contactDetailsInput.value = `${existingDetails}\n\n${normalizedDetails}`;
        }
    }

    if (contactSection) {
        contactSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    window.setTimeout(() => {
        if (!contactDetailsInput) return;

        contactDetailsInput.focus();
        const contentLength = contactDetailsInput.value.length;
        contactDetailsInput.setSelectionRange(contentLength, contentLength);
    }, 280);
}

function buildQuickQueryTemplate() {
    return "Hi, mala design project sathi query karaychi aahe. कृपया मला callback करा.";
}

function buildPackageQueryTemplate(packageName, packagePrice) {
    return `Hi, mala ${packageName} package (${packagePrice}) बद्दल details हवी आहेत. कृपया process share करा.`;
}

function buildEstimateSummary(estimate) {
    return [
        "Estimated Query Details:",
        `Service: ${estimate.serviceLabel}`,
        `Delivery: ${estimate.deliveryLabel}`,
        `Revisions: ${estimate.revisions}`,
        `Creatives: ${estimate.quantity}`,
        `Assets Ready: ${estimate.assetsReady ? "Yes" : "No"}`,
        `Estimated Budget: ${formatCurrencyINR(estimate.total)}`
    ].join("\n");
}

async function storeLead(leadPayload) {
    if (window.location.protocol === "file:") return false;

    try {
        const response = await fetch(LEAD_API_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(leadPayload),
            keepalive: true
        });

        return response.ok;
    } catch (error) {
        return false;
    }
}

async function loadCustomContent() {
    if (!customContentMount) return;

    const hasCustomAccess = await resolveCustomSectionAccess();
    if (!hasCustomAccess) {
        setCustomSectionVisible(false);
        return;
    }

    setCustomSectionVisible(true);

    const fallbackMessage =
        "<div class='custom-note'><h3>Custom file not loaded</h3><p>Edit <code>custom-content.html</code> and refresh this page.</p></div>";
    const emptyMessage =
        "<div class='custom-note'><h3>No custom content yet</h3><p>Open <code>custom-content.html</code>, add your HTML, save, and refresh.</p></div>";

    const mountCustomHtml = (html) => {
        const safeHtml = String(html || "").trim();
        if (!safeHtml || safeHtml === lastCustomContentHtml) return;
        customContentMount.innerHTML = safeHtml;
        lastCustomContentHtml = safeHtml;
    };

    try {
        const token = getOrCreateCustomDeviceToken();
        const response = await fetch(`${CUSTOM_CONTENT_ENDPOINT}?v=${Date.now()}`, {
            headers: {
                "x-custom-device-token": token
            },
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`Unable to load custom content (${response.status})`);
        }

        const rawHtml = (await response.text()).trim();
        if (!rawHtml) {
            mountCustomHtml(emptyMessage);
            return;
        }

        const parsed = new DOMParser().parseFromString(rawHtml, "text/html");
        const normalizedHtml = parsed?.body?.innerHTML?.trim() || rawHtml;
        mountCustomHtml(normalizedHtml);
    } catch (error) {
        mountCustomHtml(fallbackMessage);
    }
}

function startCustomContentWatcher() {
    if (!customContentMount || window.location.protocol === "file:" || customContentWatchTimer || customAccessAllowed === false) {
        return;
    }

    customContentWatchTimer = setInterval(() => {
        if (document.visibilityState !== "visible" || customAccessAllowed === false) return;
        loadCustomContent();
    }, 2500);
}

function applyTheme(theme) {
    const isWhiteMode = theme === "white";
    document.body.classList.toggle("white-mode", isWhiteMode);

    if (themeToggle) {
        themeToggle.setAttribute("aria-pressed", String(isWhiteMode));
        themeToggle.textContent = isWhiteMode ? "Dark Mode" : "White Block Mode";
    }
}

function getSystemThemePreference() {
    return systemThemeQuery && systemThemeQuery.matches ? "white" : "dark";
}

function bindSystemThemeListener() {
    if (!systemThemeQuery) return;

    const onSystemThemeChange = (event) => {
        if (!followSystemTheme) return;
        applyTheme(event.matches ? "white" : "dark");
    };

    if (typeof systemThemeQuery.addEventListener === "function") {
        systemThemeQuery.addEventListener("change", onSystemThemeChange);
        return;
    }

    if (typeof systemThemeQuery.addListener === "function") {
        systemThemeQuery.addListener(onSystemThemeChange);
    }
}

function setupThemeToggle() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    followSystemTheme = savedTheme !== "white" && savedTheme !== "dark";
    applyTheme(followSystemTheme ? getSystemThemePreference() : savedTheme);

    bindSystemThemeListener();

    if (!themeToggle) return;

    themeToggle.addEventListener("click", () => {
        const isWhiteMode = document.body.classList.contains("white-mode");
        const nextTheme = isWhiteMode ? "dark" : "white";
        followSystemTheme = false;
        applyTheme(nextTheme);
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    });
}

function applyLiveStatusData(payload) {
    if (!liveStatusCard || !liveStatusText || !liveTime || !liveWindow) return;

    const isOpen = payload?.isOpen ?? payload?.status === "online";

    liveStatusCard.classList.remove("online", "offline");
    liveStatusCard.classList.add(isOpen ? "online" : "offline");

    liveStatusText.textContent = isOpen ? "Available Now (Live)" : "Currently Offline";
    liveTime.textContent = `Studio Time (IST): ${payload?.studioTimeIST || "--:--"}`;

    const windowLabel = String(payload?.responseWindow || "--");
    liveWindow.textContent = windowLabel.toLowerCase().includes("response window")
        ? windowLabel
        : `Response Window: ${windowLabel}`;

    if (liveProjects) {
        const projects = Number.isFinite(payload?.activeProjects) ? payload.activeProjects : "--";
        liveProjects.textContent = `Active Projects: ${projects}`;
    }

    if (liveQueue) {
        const queue = Number.isFinite(payload?.queueLength) ? payload.queueLength : "--";
        liveQueue.textContent = `Live Queue: ${queue}`;
    }
}

function getLocalStatusPayload() {
    const now = new Date();

    const timeString = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    }).format(now);

    const hour24 = Number(
        new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            hour12: false
        }).format(now)
    );

    const isOpen = hour24 >= 10 && hour24 < 20;
    const queueLength = 1 + (now.getSeconds() % 5);
    const activeProjects = 3 + (now.getMinutes() % 4);

    return {
        status: isOpen ? "online" : "offline",
        isOpen,
        studioTimeIST: timeString,
        responseWindow: isOpen
            ? "~15 to 30 minutes"
            : "Next live window: 10:00 AM - 8:00 PM IST",
        activeProjects,
        queueLength
    };
}

function updateLocalLiveStatus() {
    applyLiveStatusData(getLocalStatusPayload());
}

function startLocalStatusTicker() {
    if (localStatusTimer) return;
    updateLocalLiveStatus();
    localStatusTimer = setInterval(updateLocalLiveStatus, 1000);
}

function connectRealtimeStatus() {
    if (!liveStatusCard) return;

    if (!window.EventSource || window.location.protocol === "file:") {
        startLocalStatusTicker();
        return;
    }

    let hasLiveMessage = false;

    fetch("/api/live-status")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
            if (data) {
                applyLiveStatusData(data);
            }
        })
        .catch(() => {
            /* no-op */
        });

    const stream = new EventSource("/api/live-stream");

    stream.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            hasLiveMessage = true;
            applyLiveStatusData(data);
        } catch (error) {
            // ignore malformed messages and keep stream alive
        }
    };

    stream.onerror = () => {
        stream.close();
        if (!hasLiveMessage) {
            startLocalStatusTicker();
        }
    };
}

function calculateEstimate() {
    if (!estService || !estDelivery || !estRevisions || !estQuantity || !estAssets) return null;

    const serviceBasePrice = {
        brand: 6999,
        social: 3499,
        poster: 2499,
        web: 5999
    };

    const serviceLabel = {
        brand: "Brand Identity",
        social: "Social Media Creatives",
        poster: "Poster / Print Design",
        web: "Web Visual Design"
    };

    const deliveryMultiplier = {
        standard: 1,
        express: 1.35,
        priority: 1.6
    };

    const deliveryLabel = {
        standard: "Standard (3-5 days)",
        express: "Express (48 hours)",
        priority: "Priority (24 hours)"
    };

    const service = estService.value;
    const delivery = estDelivery.value;
    const revisions = Math.max(1, Number(estRevisions.value) || 1);
    const quantity = Math.max(1, Math.min(50, Number(estQuantity.value) || 1));
    const assetsReady = Boolean(estAssets.checked);

    const base = serviceBasePrice[service] || 3000;
    let subtotal = base * quantity;

    subtotal *= deliveryMultiplier[delivery] || 1;

    if (revisions > 2) {
        subtotal += (revisions - 2) * 450 * quantity;
    }

    subtotal = assetsReady ? subtotal * 0.92 : subtotal + 1200;

    const total = Math.round(subtotal / 100) * 100;

    return {
        service,
        serviceLabel: serviceLabel[service] || "Custom Service",
        delivery,
        deliveryLabel: deliveryLabel[delivery] || "Custom",
        revisions,
        quantity,
        assetsReady,
        total
    };
}

function renderEstimate() {
    const estimate = calculateEstimate();
    if (!estimate || !estimateAmount || !estimateBreakdown || !estimateMeta || !revCount) return;

    latestEstimate = estimate;
    revCount.textContent = String(estimate.revisions);
    estimateAmount.textContent = formatCurrencyINR(estimate.total);

    estimateBreakdown.textContent =
        `Based on ${estimate.serviceLabel}, ${estimate.deliveryLabel.toLowerCase()}, and ${estimate.quantity} creative(s).`;

    estimateMeta.innerHTML = [
        `<li>Service: ${estimate.serviceLabel}</li>`,
        `<li>Delivery: ${estimate.deliveryLabel}</li>`,
        `<li>Revisions: ${estimate.revisions}</li>`,
        `<li>Assets Ready: ${estimate.assetsReady ? "Yes" : "No"}</li>`
    ].join("");
}

function setupEstimator() {
    if (!estimatorForm) return;

    [estService, estDelivery, estRevisions, estQuantity, estAssets].forEach((field) => {
        if (!field) return;
        field.addEventListener("input", renderEstimate);
        field.addEventListener("change", renderEstimate);
    });

    if (sendEstimateBtn) {
        sendEstimateBtn.addEventListener("click", (event) => {
            event.preventDefault();
            if (!latestEstimate) return;

            prefillContactFormAndFocus({
                service: latestEstimate.serviceLabel,
                budget: getBudgetRangeFromAmount(latestEstimate.total),
                details: buildEstimateSummary(latestEstimate)
            });

            triggerQueryFormAnimation("pulse");
            showQuerySubmitMessage("Estimate details form मध्ये भरले आहेत. कृपया नाव/email टाकून Submit Query करा.", "info");
        });
    }

    renderEstimate();
}

function setupNavActiveTracking() {
    if (!navSectionLinks.length) return;

    const sectionMap = [...navSectionLinks]
        .map((link) => {
            const selector = link.getAttribute("href");
            const section = selector ? document.querySelector(selector) : null;
            return section ? { link, section } : null;
        })
        .filter(Boolean);

    if (!sectionMap.length) return;

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;

                sectionMap.forEach(({ link, section }) => {
                    link.classList.toggle("active-link", section === entry.target);
                });
            });
        },
        {
            root: null,
            threshold: 0.25,
            rootMargin: "-30% 0px -55% 0px"
        }
    );

    sectionMap.forEach(({ section }) => observer.observe(section));
}

function handleScrollUi() {
    const scrollTop = window.scrollY;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const progress = maxScroll > 0 ? (scrollTop / maxScroll) * 100 : 0;

    if (scrollProgress) {
        scrollProgress.style.width = `${progress}%`;
    }

    if (backToTop) {
        backToTop.classList.toggle("show", scrollTop > 420);
    }
}

if (backToTop) {
    backToTop.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });
}

if (menuToggle && mainNav) {
    menuToggle.addEventListener("click", () => {
        const isOpen = mainNav.classList.toggle("open");
        menuToggle.setAttribute("aria-expanded", String(isOpen));
    });

    mainNav.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
            mainNav.classList.remove("open");
            menuToggle.setAttribute("aria-expanded", "false");
        });
    });
}

quickQueryLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
        event.preventDefault();

        prefillContactFormAndFocus({
            service: "Social Media Creatives",
            details: buildQuickQueryTemplate()
        });

        triggerQueryFormAnimation("pulse");
        showQuerySubmitMessage("Query form open झाला आहे. Details तपासून Submit Query करा.", "info");
    });
});

packageQueryLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
        event.preventDefault();
        const packageName = link.dataset.package || "Selected";
        const packagePrice = link.dataset.price || "Custom";

        prefillContactFormAndFocus({
            service: "Social Media Creatives",
            budget: mapPackagePriceToBudget(packagePrice),
            details: buildPackageQueryTemplate(packageName, packagePrice)
        });

        triggerQueryFormAnimation("pulse");
        showQuerySubmitMessage("Package query form मध्ये भरली आहे. कृपया Submit Query करा.", "info");
    });
});

if (queryForm) {
    queryForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const name = contactNameInput ? contactNameInput.value.trim() : "";
        const email = contactEmailInput ? contactEmailInput.value.trim() : "";
        const service = contactServiceInput ? contactServiceInput.value : "";
        const budget = contactBudgetInput ? contactBudgetInput.value : "";
        const details = contactDetailsInput ? contactDetailsInput.value.trim() : "";

        if (!name || !email || !service || !budget || !details) {
            triggerQueryFormAnimation("error");
            showQuerySubmitMessage("Please fill all fields before submitting query.", "error");
            return;
        }

        triggerQueryFormAnimation("pulse");
        setQueryFormSubmittingState(true);

        try {
            const saved = await storeLead({
                source: "contact-query",
                name,
                email,
                service,
                budget,
                details
            });

            if (!saved) {
                triggerQueryFormAnimation("error");
                showQuerySubmitMessage("Query submit zali nahi. कृपया पुन्हा try करा.", "error");
                return;
            }

            triggerQueryFormAnimation("success");
            showQuerySubmitMessage("तुमची query submit झाली. Admin panel मध्ये लगेच दिसेल.", "success");
            queryForm.reset();
        } finally {
            setQueryFormSubmittingState(false);
        }
    });
}

filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const selectedFilter = button.dataset.filter;

        filterButtons.forEach((btn) => btn.classList.remove("active"));
        button.classList.add("active");

        portfolioItems.forEach((item) => {
            const category = item.dataset.category;
            const shouldShow = selectedFilter === "all" || category === selectedFilter;
            item.classList.toggle("hidden", !shouldShow);
        });
    });
});

const revealObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("show");
                revealObserver.unobserve(entry.target);
            }
        });
    },
    {
        threshold: 0.16
    }
);

revealElements.forEach((element) => revealObserver.observe(element));

loadCustomContent();
startCustomContentWatcher();
setupEstimator();
setupNavActiveTracking();
connectRealtimeStatus();
loadDeployVersionBadge();
setupThemeToggle();
handleScrollUi();

window.addEventListener("scroll", handleScrollUi, { passive: true });

const yearElement = document.getElementById("year");
if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
}
