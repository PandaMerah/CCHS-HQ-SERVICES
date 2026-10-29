import { subscribeState, subscribeSyncStatus } from '/shared/cloud-store.js';

let currentSlideIndex = 0;
let totalSlides = 0;
let departmentNames = [];
let slideMeta = [];
let autoPlayInterval = null;
let currentSyncMode = 'connecting';

subscribeSyncStatus(({ mode }) => {
    currentSyncMode = mode;
    const statusLabel = document.getElementById('sync-mode-label');
    if (statusLabel) {
        statusLabel.textContent = mode === 'firebase' ? 'Live Firebase Broadcast' : 'Live Cloud Broadcast Active';
    }
});

subscribeState((data) => {
    if (data) {
        buildSlides(data);
    }
});

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

function buildSlides(data) {
    const container = document.getElementById('slides-container');
    if (!container) return;
    container.innerHTML = '';
    departmentNames = Object.keys(data.departments || {});
    slideMeta = [];
    const config = data.config || {};

    // 1. Overview Main Page
    container.innerHTML += `
        <div class="slide">
            <div class="cc-card overview-card">
                <div class="overview-header">
                    <img src="/careclinic-logo.webp" alt="Care Clinics Logo" class="overview-logo" onerror="this.src='/images/acme-logo.svg'">
                    <div class="overview-clock-box">
                        <div class="overview-time" id="main-clock-time">--:--:--</div>
                        <div class="overview-date" id="main-clock-date">-----, -- ---- ----</div>
                    </div>
                </div>
                
                <h1 style="margin-top: 24px;">Weekly Alignment Meeting</h1>
                <p class="update-text" style="max-width: 900px;">
                    Humanising Care — While we embrace technology in the delivery and improvement of quality care, the human touch remains the essence of our service.
                </p>

                <div class="overview-status-bar">
                    <div class="status-chip">
                        <span>Active Departments:</span> <strong>${departmentNames.length}</strong>
                    </div>
                    <div class="status-chip">
                        <span>Status:</span> <strong id="sync-mode-label" style="color: #00b894;">${currentSyncMode === 'firebase' ? 'Live Firebase Broadcast' : 'Live Cloud Broadcast Active'}</strong>
                    </div>
                </div>
            </div>
        </div>`;
    slideMeta.push({ label: 'Overview', icon: '❯' });

    // 2. Department Updates & Conditional Q&A Loop (Forza Slot Reel)
    for (const dept of departmentNames) {
        const deptData = data.departments[dept] || {};

        // Update Slide
        container.innerHTML += `
            <div class="slide">
                <div class="cc-card">
                    <div class="cc-card-tag">${escapeHtml(dept)}</div>
                    <h2>Weekly Department Update</h2>
                    <p class="update-text">${escapeHtml(deptData.update || "No update provided.")}</p>
                </div>
            </div>`;
        slideMeta.push({ label: `${dept} Update`, icon: '❯' });

        // Conditional Q&A Slide (Forza Style Vertical Reel)
        if (config.showQnA !== false) {
            container.innerHTML += `
                <div class="slide qna-slide">
                    <div class="cc-card">
                        <div class="qna-layout">
                            <div>
                                <div class="cc-card-tag" style="background: rgba(245, 158, 11, 0.15); color: #d97706;">Question</div>
                                <h2>${escapeHtml(dept)}</h2>
                                <p class="update-text">${escapeHtml(deptData.question || "No question submitted.")}</p>
                            </div>
                            <div class="forza-spin-section">
                                <h2>Who answers?</h2>
                                <div class="forza-slot-window" onclick="spinCurrentSlideReel(this)" title="Click or press ENTER to spin">
                                    <div class="forza-slot-pointer-top">▼</div>
                                    <div class="forza-slot-reel" id="reel-${dept.replace(/\s+/g, '')}">
                                        <div class="forza-slot-item">Press ENTER</div>
                                    </div>
                                    <div class="forza-slot-pointer-bottom">▲</div>
                                </div>
                                <p style="font-size: 1.1rem; color: var(--cc-text-muted); margin-top: 12px;">Press <strong>ENTER</strong> or <strong>Click Reel</strong> to Spin</p>
                                <div class="winner-text"></div>
                            </div>
                        </div>
                    </div>
                </div>`;
            slideMeta.push({ label: `${dept} Q&A`, icon: '🎲' });
        }
    }

    // 3. Vision & Mission Slide
    if (config.showVisionMission !== false) {
        container.innerHTML += `
            <div class="slide">
                <div class="cc-card">
                    <div class="cc-card-tag">Core Values</div>
                    <h1>Vision & Mission</h1>
                    <div class="pill-grid">
                        <div class="sub-card">
                            <h2>Vision</h2>
                            <p>${escapeHtml(config.visionText || "Humanising Care through innovative solutions.")}</p>
                        </div>
                        <div class="sub-card">
                            <h2>Mission</h2>
                            <p>${escapeHtml(config.missionText || "Delivering quality healthcare where the human touch is essence.")}</p>
                        </div>
                    </div>
                </div>
            </div>`;
        slideMeta.push({ label: 'Vision & Mission', icon: '❯' });
    }

    // 4. Tagline Slide ("Humanising Care")
    container.innerHTML += `
        <div class="slide">
            <div class="cc-card" style="align-items: center; text-align: center; justify-content: center;">
                <div class="cc-card-tag">Our Tagline</div>
                <h1 class="tagline-display">Humanising Care</h1>
            </div>
        </div>`;
    slideMeta.push({ label: 'Tagline', icon: '❯' });

    // 5. Care Quality Phrases Slide
    if (config.showDailyPhrases !== false) {
        container.innerHTML += `
            <div class="slide">
                <div class="cc-card" style="padding: 48px;">
                    <div class="cc-card-tag">Culture</div>
                    <h1 style="font-size: 2.8rem; margin-bottom: 16px;">CARE QUALITY PHRASES</h1>
                    
                    <div class="care-phrases-table-container">
                        <table class="care-phrases-table">
                            <tbody>
                                <tr>
                                    <td>Good morning/ afternoon/evening Mr/Ms</td>
                                    <td>Salam Careclinics Encik/Cik/Puan</td>
                                </tr>
                                <tr>
                                    <td>How may I assist you Mr/Ms</td>
                                    <td>Ada apa saya boleh bantu Encik/Cik/Puan</td>
                                </tr>
                                <tr>
                                    <td>Please wait a moment Mr/Ms</td>
                                    <td>Sila tunggu sebentar Encik/Cik/Puan</td>
                                </tr>
                                <tr>
                                    <td>Excuse me Mr/Ms</td>
                                    <td>Maaf Encik/Cik/Puan</td>
                                </tr>
                                <tr>
                                    <td>I am sorry for the inconvenience Mr/Ms</td>
                                    <td>Maaf di atas kesulitan Encik/Cik/Puan</td>
                                </tr>
                                <tr>
                                    <td>Thank you Mr/Ms</td>
                                    <td>Terima Kasih Encik/Cik/Puan</td>
                                </tr>
                                <tr>
                                    <td>Please get well soon Mr/Ms</td>
                                    <td>Semoga cepat sembuh Encik/Cik/Puan</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>`;
        slideMeta.push({ label: 'Care Quality Phrases', icon: '❯' });
    }

    // 6. C-Suite Closing Remarks Slide
    if (config.showLastMinuteSpeech === true) {
        container.innerHTML += `
            <div class="slide">
                <div class="cc-card">
                    <div class="cc-card-tag" style="background: rgba(17, 35, 73, 0.1); color: var(--cc-navy);">Closing</div>
                    <h2>C-Suite Closing Remarks</h2>
                    <p class="update-text">${escapeHtml(config.lastMinuteSpeechText || "")}</p>
                </div>
            </div>`;
        slideMeta.push({ label: 'C-Suite Closing Remarks', icon: '❯' });
    }

    totalSlides = slideMeta.length;
    if (currentSlideIndex >= totalSlides) currentSlideIndex = 0;

    renderSidebarMenu();
    updateSlidePosition();
    updateClocks();
    initReels();
}

function initReels() {
    const repeatedDepts = [];
    for (let i = 0; i < 5; i++) {
        repeatedDepts.push(...departmentNames);
    }
    document.querySelectorAll('.forza-slot-reel').forEach(reel => {
        reel.innerHTML = repeatedDepts.map(d => `<div class="forza-slot-item">${escapeHtml(d)}</div>`).join('');
    });
}

function renderSidebarMenu() {
    const menuContainer = document.getElementById('sidebar-menu');
    if (!menuContainer) return;
    menuContainer.innerHTML = slideMeta.map((item, idx) => `
        <div class="dept-pill ${idx === currentSlideIndex ? 'active' : ''}" onclick="goToSlide(${idx})">
            <span>${escapeHtml(item.label)}</span>
            <span style="font-size: 0.9rem; opacity: 0.8;">${item.icon}</span>
        </div>
    `).join('');
}

function goToSlide(index) {
    currentSlideIndex = index;
    updateSlidePosition();
}

function changeSlide(direction) {
    currentSlideIndex = Math.max(0, Math.min(totalSlides - 1, currentSlideIndex + direction));
    updateSlidePosition();
}

function updateSlidePosition() {
    const container = document.getElementById('slides-container');
    if (!container) return;
    container.style.transform = `translateX(-${currentSlideIndex * 100}%)`;
    const indicator = document.getElementById('slide-indicator');
    if (indicator) indicator.innerText = `${currentSlideIndex + 1} / ${totalSlides}`;
    renderSidebarMenu();

    const activePill = document.querySelector('.dept-pill.active');
    if (activePill) {
        activePill.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Forza Horizon Style Vertical Slot Spin (0.5s duration with bounce)
function spinForzaReel(slideElement) {
    const reel = slideElement.querySelector('.forza-slot-reel');
    const winnerDisplay = slideElement.querySelector('.winner-text');
    if (!reel || departmentNames.length === 0) return;

    winnerDisplay.innerText = "SPINNING...";
    winnerDisplay.style.color = "#f59e0b";
    reel.style.transition = "none";
    reel.style.transform = "translateY(0)";

    // Force reflow
    void reel.offsetHeight;

    // Pick random winner
    const winningIndex = Math.floor(Math.random() * departmentNames.length);
    const itemHeight = 90; // Height of each slot item in px
    
    // Add extra full loops for excitement, landing on winningIndex
    const totalLoops = 3;
    const targetTranslateY = -((totalLoops * departmentNames.length + winningIndex) * itemHeight);

    // Fast 0.5 seconds spin with cubic-bezier for mechanical game feel
    reel.style.transition = "transform 0.5s cubic-bezier(0.15, 0.85, 0.25, 1.15)";
    reel.style.transform = `translateY(${targetTranslateY}px)`;

    setTimeout(() => {
        winnerDisplay.innerText = `WINNER: ${departmentNames[winningIndex]}!`;
        winnerDisplay.style.color = "#1863dc";
        
        const slotWindow = slideElement.querySelector('.forza-slot-window');
        if (slotWindow) {
            slotWindow.classList.add('win-flash');
            setTimeout(() => slotWindow.classList.remove('win-flash'), 600);
        }
    }, 500);
}

function spinCurrentSlideReel(el) {
    const slideEl = el.closest('.slide');
    if (slideEl) spinForzaReel(slideEl);
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

function toggleAutoPlay() {
    const btn = document.getElementById('btn-autoplay');
    if (autoPlayInterval) {
        clearInterval(autoPlayInterval);
        autoPlayInterval = null;
        if (btn) {
            btn.innerText = "▶ Auto";
            btn.style.background = "";
        }
    } else {
        autoPlayInterval = setInterval(() => {
            currentSlideIndex = (currentSlideIndex + 1) % totalSlides;
            updateSlidePosition();
        }, 8000);
        if (btn) {
            btn.innerText = "⏸ Auto";
            btn.style.background = "#1863dc";
        }
    }
}

function updateClocks() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const dateStr = now.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const sbTime = document.getElementById('sidebar-time');
    const sbDate = document.getElementById('sidebar-date');
    if (sbTime) sbTime.innerText = timeStr;
    if (sbDate) sbDate.innerText = dateStr;

    const mainTime = document.getElementById('main-clock-time');
    const mainDate = document.getElementById('main-clock-date');
    if (mainTime) mainTime.innerText = timeStr;
    if (mainDate) mainDate.innerText = dateStr;
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') changeSlide(1);
    if (e.key === 'ArrowLeft') changeSlide(-1);
    if (e.key === 'Enter') {
        const currentSlideEl = document.querySelectorAll('.slide')[currentSlideIndex];
        if (currentSlideEl && currentSlideEl.querySelector('.forza-slot-reel')) {
            spinForzaReel(currentSlideEl);
        }
    }
});

setInterval(updateClocks, 1000);

// Expose functions to global scope for inline HTML handlers
window.goToSlide = goToSlide;
window.changeSlide = changeSlide;
window.toggleFullScreen = toggleFullScreen;
window.toggleAutoPlay = toggleAutoPlay;
window.spinCurrentSlideReel = spinCurrentSlideReel;
