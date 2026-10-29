
const content = document.getElementById("content");
const tokenKey = "intellimatch_access_token";

// ---------- API HELPERS ----------

function getToken() {
    return sessionStorage.getItem(tokenKey);
}

async function api(url, options = {}, authenticated = false) {
    const headers = { ...(options.headers || {}) };

    if (options.body) {
        headers["Content-Type"] = "application/json";
    }

    if (authenticated) {
        const token = getToken();

        if (!token) {
            throw new Error("Please log in to continue.");
        }

        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Request failed (${response.status})`);
    }

    return data;
}

function showMessage(id, message, isError = false) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = message;
        element.classList.toggle("error-message", isError);
    }
}

function setPage(title, page) {
    document.getElementById("page-title").textContent = title;

    document.querySelectorAll(".nav-item").forEach(button => {
        button.classList.toggle("active", button.dataset.page === page);
    });

    
}


function updateAuthStatus() {
    const loggedIn = Boolean(getToken());
    const status = document.getElementById("auth-status");
    const logoutButton = document.getElementById("logout-button");

    if (status) {
        status.textContent = loggedIn ? "Logged in" : "Not logged in";
    }

    if (logoutButton) {
        logoutButton.hidden = !loggedIn;
    }
}

function logout() {
    sessionStorage.removeItem(tokenKey);
    updateAuthStatus();
    showLogin("You have been logged out.");
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

// ---------- LOGIN ----------

function showLogin(message = "") {
    setPage("Login", "");

    content.innerHTML = `
        <section class="auth-card">
            <p class="eyebrow">WELCOME BACK</p>
            <h2>Log in to IntelliMatch</h2>
            <p>Access your profile and discover project opportunities.</p>

            <form id="login-form" class="auth-form">
                <label for="login-email">Email address</label>
                <input id="login-email" type="email"
                    autocomplete="email" required maxlength="254"
                    placeholder="you@example.com">

                <label for="login-password">Password</label>
                <input id="login-password" type="password"
                    autocomplete="current-password" required maxlength="128">

                <button class="primary-button" type="submit">Log in</button>
            </form>

            <p id="auth-message" class="message" aria-live="polite"></p>

            <p>New student?
                <button id="show-register" class="text-button" type="button">
                    Create an account
                </button>
            </p>
        </section>`;

    if (message) {
        showMessage("auth-message", message);
    }

    document.getElementById("show-register")
        .addEventListener("click", showRegister);

    document.getElementById("login-form")
        .addEventListener("submit", async event => {
            event.preventDefault();

            const button = event.submitter;
            button.disabled = true;
            showMessage("auth-message", "Signing in...");

            try {
                const result = await api("/api/auth/login", {
                    method: "POST",
                    body: JSON.stringify({
                        email: document.getElementById("login-email").value.trim(),
                        password: document.getElementById("login-password").value
                    })
                });

                sessionStorage.setItem(tokenKey, result.access_token);
                updateAuthStatus();
                await showProfile();
            } catch (error) {
                showMessage("auth-message", error.message, true);
            } finally {
                button.disabled = false;
            }
        });
}

// ---------- REGISTRATION ----------

async function showRegister() {
    setPage("Create Account", "");

    content.innerHTML = `
        <section class="auth-card">
            <p class="eyebrow">JOIN INTELLIMATCH</p>
            <h2>Create your student account</h2>
            <p>Your profile will be saved to PostgreSQL.</p>

            <form id="register-form" class="auth-form">
                <label for="reg-name">Full name</label>
                <input id="reg-name" required minlength="2" maxlength="150"
                    autocomplete="name" placeholder="Your full name">

                <label for="reg-email">Email address</label>
                <input id="reg-email" type="email" required maxlength="254"
                    autocomplete="email" placeholder="you@example.com">

                <label for="reg-password">Password (at least 8 characters)</label>
                <input id="reg-password" type="password" required minlength="8"
                    maxlength="128" autocomplete="new-password">

                <label for="reg-year">Academic year</label>
                <select id="reg-year" required>
                    <option value="">Select academic year</option>
                    <option value="1">First year</option>
                    <option value="2">Second year</option>
                    <option value="3">Third year</option>
                    <option value="4">Fourth year</option>
                    <option value="5">Fifth year</option>
                    <option value="6">Sixth year</option>
                </select>

                <label for="reg-department">Department (optional)</label>
                <select id="reg-department">
                    <option value="">No department selected</option>
                </select>

                <label for="reg-hours">Weekly availability (hours)</label>
                <input id="reg-hours" type="number" min="0" max="100"
                    value="5" required>

                <button class="primary-button" type="submit">
                    Create account
                </button>
            </form>

            <p id="auth-message" class="message" aria-live="polite"></p>

            <p>Already registered?
                <button id="show-login" class="text-button" type="button">
                    Log in
                </button>
            </p>
        </section>`;

    document.getElementById("show-login")
        .addEventListener("click", () => showLogin());

    try {
        const departments = await api("/api/departments");
        const select = document.getElementById("reg-department");

        departments.forEach(department => {
            select.add(new Option(
                department.department_name,
                department.department_id
            ));
        });
    } catch (error) {
        showMessage(
            "auth-message",
            "Departments could not be loaded. You can still register without one."
        );
    }

    document.getElementById("register-form")
        .addEventListener("submit", async event => {
            event.preventDefault();

            const button = event.submitter;
            button.disabled = true;
            showMessage("auth-message", "Creating your account...");

            try {
                const departmentValue =
                    document.getElementById("reg-department").value;

                await api("/api/auth/register", {
                    method: "POST",
                    body: JSON.stringify({
                        full_name: document.getElementById("reg-name").value.trim(),
                        email: document.getElementById("reg-email").value.trim(),
                        password: document.getElementById("reg-password").value,
                        academic_year: Number(
                            document.getElementById("reg-year").value
                        ),
                        department_id: departmentValue
                            ? Number(departmentValue)
                            : null,
                        weekly_availability_hours: Number(
                            document.getElementById("reg-hours").value
                        )
                    })
                });

                showLogin("Account created successfully. Please log in.");
            } catch (error) {
                showMessage("auth-message", error.message, true);
            } finally {
                button.disabled = false;
            }
        });
}

// ---------- MY PROFILE, SKILLS AND INTERESTS ----------

async function showProfile() {
    setPage("My Profile", "profile");

    content.innerHTML = `
        <section class="panel">
            <h2>Loading your profile...</h2>
        </section>`;

    try {
        const [profile, skills, interests, departments] = await Promise.all([
            api("/api/profile", {}, true),
            api("/api/skills"),
            api("/api/interests"),
            api("/api/departments")
        ]);

        content.innerHTML = `
            <section class="panel">
                <p class="eyebrow">YOUR ACCOUNT</p>
                <h2>My Profile</h2>
                <p class="message">Changes are saved to PostgreSQL.</p>

                <form id="profile-form" class="auth-form">
                    <label for="profile-name-input">Full name</label>
                    <input id="profile-name-input" required minlength="2"
                        maxlength="150">

                    <label for="profile-year-input">Academic year</label>
                    <select id="profile-year-input" required>
                        ${[1, 2, 3, 4, 5, 6].map(year =>
                            `<option value="${year}">Year ${year}</option>`
                        ).join("")}
                    </select>

                    <label for="profile-dept-input">Department</label>
                    <select id="profile-dept-input">
                        <option value="">Not specified</option>
                        ${departments.map(department =>
                            `<option value="${department.department_id}">
                                ${escapeHTML(department.department_name)}
                            </option>`
                        ).join("")}
                    </select>

                    <label for="profile-hours-input">
                        Weekly availability (hours)
                    </label>
                    <input id="profile-hours-input" type="number"
                        min="0" max="100" required>

                    <button class="primary-button" type="submit">
                        Save profile
                    </button>
                </form>

                <p id="profile-save-message" class="message"
                    aria-live="polite"></p>
            </section>

            <section class="panel">
                <p class="eyebrow">YOUR EXPERTISE</p>
                <h2>My Skills</h2>
                <form id="skills-form" class="auth-form">
                    <div id="skills-options"></div>
                    <button class="primary-button" type="submit">Save skills</button>
                </form>
                <p id="skills-save-message" class="message"
                    aria-live="polite"></p>
            </section>

            <section class="panel">
                <p class="eyebrow">YOUR INTERESTS</p>
                <h2>My Interests</h2>
                <form id="interests-form" class="auth-form">
                    <div id="interests-options"></div>
                    <button class="primary-button" type="submit">
                        Save interests
                    </button>
                </form>
                <p id="interests-save-message" class="message"
                    aria-live="polite"></p>
            </section>`;

        document.getElementById("profile-name-input").value = profile.full_name;
        document.getElementById("profile-year-input").value =
            profile.academic_year;
        document.getElementById("profile-dept-input").value =
            profile.department_id ?? "";
        document.getElementById("profile-hours-input").value =
            profile.weekly_availability_hours;

        const selectedSkills = new Map(
            profile.skills.map(skill => [skill.skill_id, skill])
        );

        const skillsOptions = document.getElementById("skills-options");

        skills.forEach(skill => {
            const current = selectedSkills.get(skill.skill_id);
            const row = document.createElement("div");
            row.className = "skill-editor";

            const label = document.createElement("label");
            const checkbox = document.createElement("input");

            checkbox.type = "checkbox";
            checkbox.className = "skill-checkbox";
            checkbox.value = skill.skill_id;
            checkbox.checked = Boolean(current);

            const title = document.createElement("span");
            title.textContent = `${skill.skill_name} (${skill.category})`;
            label.append(checkbox, title);

            const proficiency = document.createElement("select");
            proficiency.className = "skill-proficiency";
            proficiency.setAttribute(
                "aria-label",
                `${skill.skill_name} proficiency`
            );

            ["Beginner", "Intermediate", "Advanced"].forEach(level => {
                proficiency.add(new Option(level, level));
            });

            proficiency.value = current?.proficiency || "Beginner";

            const experience = document.createElement("input");
            experience.type = "number";
            experience.min = "0";
            experience.max = "600";
            experience.value = current?.experience_months ?? 0;
            experience.className = "skill-experience";
            experience.setAttribute(
                "aria-label",
                `${skill.skill_name} experience in months`
            );
            experience.placeholder = "Months";

            row.append(label, proficiency, experience);
            skillsOptions.append(row);
        });

        const selectedInterests = new Set(
            profile.interests.map(interest => interest.interest_id)
        );

        const interestsOptions = document.getElementById("interests-options");

        interests.forEach(interest => {
            const label = document.createElement("label");
            label.className = "interest-option";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "interest-checkbox";
            checkbox.value = interest.interest_id;
            checkbox.checked = selectedInterests.has(interest.interest_id);

            const text = document.createElement("span");
            text.textContent = interest.interest_name;

            label.append(checkbox, text);
            interestsOptions.append(label);
        });

        document.getElementById("profile-form")
            .addEventListener("submit", async event => {
                event.preventDefault();

                const button = event.submitter;
                button.disabled = true;

                try {
                    const departmentValue =
                        document.getElementById("profile-dept-input").value;

                    await api("/api/profile", {
                        method: "PUT",
                        body: JSON.stringify({
                            full_name: document.getElementById(
                                "profile-name-input"
                            ).value.trim(),
                            academic_year: Number(
                                document.getElementById("profile-year-input").value
                            ),
                            department_id: departmentValue
                                ? Number(departmentValue)
                                : null,
                            weekly_availability_hours: Number(
                                document.getElementById("profile-hours-input").value
                            )
                        })
                    }, true);

                    showMessage(
                        "profile-save-message",
                        "Profile saved successfully."
                    );
                } catch (error) {
                    showMessage("profile-save-message", error.message, true);
                } finally {
                    button.disabled = false;
                }
            });

        document.getElementById("skills-form")
            .addEventListener("submit", async event => {
                event.preventDefault();

                const button = event.submitter;
                button.disabled = true;

                try {
                    const selected = [
                        ...document.querySelectorAll(".skill-checkbox:checked")
                    ];

                    const payload = selected.map(checkbox => {
                        const row = checkbox.closest(".skill-editor");
                        const months = Number(
                            row.querySelector(".skill-experience").value
                        );

                        if (
                            !Number.isInteger(months) ||
                            months < 0 ||
                            months > 600
                        ) {
                            throw new Error(
                                "Experience must be between 0 and 600 months."
                            );
                        }

                        return {
                            skill_id: Number(checkbox.value),
                            proficiency: row.querySelector(
                                ".skill-proficiency"
                            ).value,
                            experience_months: months
                        };
                    });

                    await api("/api/profile/skills", {
                        method: "PUT",
                        body: JSON.stringify({ skills: payload })
                    }, true);

                    showMessage(
                        "skills-save-message",
                        "Skills saved successfully."
                    );
                } catch (error) {
                    showMessage("skills-save-message", error.message, true);
                } finally {
                    button.disabled = false;
                }
            });

        document.getElementById("interests-form")
            .addEventListener("submit", async event => {
                event.preventDefault();

                const button = event.submitter;
                button.disabled = true;

                try {
                    const ids = [
                        ...document.querySelectorAll(".interest-checkbox:checked")
                    ].map(checkbox => Number(checkbox.value));

                    await api("/api/profile/interests", {
                        method: "PUT",
                        body: JSON.stringify({ interest_ids: ids })
                    }, true);

                    showMessage(
                        "interests-save-message",
                        "Interests saved successfully."
                    );
                } catch (error) {
                    showMessage(
                        "interests-save-message",
                        error.message,
                        true
                    );
                } finally {
                    button.disabled = false;
                }
            });

    } catch (error) {
        if (/token|log in|unauthorized/i.test(error.message)) {
            logout();
            return;
        }

        content.innerHTML = `
            <section class="panel">
                <h2>Could not load profile</h2>
                <p id="profile-load-error" class="error-message"></p>
            </section>`;

        document.getElementById("profile-load-error").textContent =
            error.message;
    }
}

// ---------- DASHBOARD ----------

async function loadDashboard() {
    setPage("Dashboard", "dashboard");

    content.innerHTML = `
        <section class="panel">
            <h2>Loading dashboard...</h2>
        </section>`;

    try {
        const [students, projects] = await Promise.all([
            api("/api/students"),
            api("/api/projects")
        ]);

        content.innerHTML = `
            <div class="welcome">
                <p class="eyebrow">INTELLIGENT TEAM FORMATION</p>
                <h2>Find the right people<br>for your next project.</h2>
                <p>Explore student skills and discover project matches.</p>
            </div>

            <div class="stats">
                <article class="stat-card">
                    <p>Total students</p>
                    <h2>${students.length}</h2>
                    <span>Registered profiles</span>
                </article>
                <article class="stat-card">
                    <p>Available projects</p>
                    <h2>${projects.length}</h2>
                    <span>Project opportunities</span>
                </article>
                <article class="stat-card">
                    <p>Matching engine</p>
                    <h2 class="ready">Ready</h2>
                    <span>Rule-based skill matching</span>
                </article>
            </div>

            <section class="panel">
                <div class="panel-heading">
                    <p class="eyebrow">RECOMMENDATIONS</p>
                    <h2>Find your project team</h2>
                </div>

                <label for="project-select">Choose a project</label>
                <div class="match-controls">
                    <select id="project-select">
                        <option value="">Select a project...</option>
                    </select>
                    <button id="find-matches" class="primary-button">
                        Find matches →
                    </button>
                </div>

                <p id="message" class="message" aria-live="polite"></p>
                <div id="matches" class="matches"></div>
            </section>`;

        const select = document.getElementById("project-select");

        projects.forEach(project => {
            select.add(new Option(project.title, project.project_id));
        });

        document.getElementById("find-matches")
            .addEventListener("click", findMatches);

    } catch (error) {
        content.innerHTML = `
            <section class="panel">
                <h2>Dashboard unavailable</h2>
                <p id="dashboard-error" class="error-message"></p>
            </section>`;

        document.getElementById("dashboard-error").textContent =
            error.message;
    }
}

// ---------- SKILL MATCHING ----------

async function findMatches() {
    const projectId = document.getElementById("project-select").value;
    const button = document.getElementById("find-matches");
    const container = document.getElementById("matches");

    if (!projectId) {
        showMessage("message", "Please select a project first.", true);
        return;
    }

    button.disabled = true;
    container.replaceChildren();
    showMessage("message", "Calculating skill matches...");

    try {
        const results = await api(
            `/api/projects/${encodeURIComponent(projectId)}/matches`
        );

        if (results.length === 0) {
            showMessage("message", "No student matches found.");
            return;
        }

        results.forEach((student, index) => {
            const card = document.createElement("article");
            card.className = "match-card";

            const details = document.createElement("div");
            const name = document.createElement("div");
            name.className = "match-name";
            name.textContent = `${index + 1}. ${student.full_name}`;

            const subtitle = document.createElement("div");
            subtitle.className = "match-subtitle";
            subtitle.textContent = "Rule-based skill match";

            details.append(name, subtitle);

            const score = document.createElement("div");
            score.className = "score";
            score.textContent =
                `${Number(student.match_percentage).toFixed(2)}%`;

            card.append(details, score);
            container.append(card);
        });

        showMessage("message", `Found ${results.length} student matches.`);
    } catch (error) {
        showMessage("message", error.message, true);
    } finally {
        button.disabled = false;
    }
}

// ---------- STUDENT DIRECTORY ----------

async function showStudents() {
    setPage("Students", "students");

    content.innerHTML = `
        <section class="panel">
            <h2>Students and their skills</h2>
            <p id="page-message" class="message">Loading students...</p>
            <div id="student-list" class="table-wrap"></div>
        </section>`;

    try {
        const students = await api("/api/students/details");
        showMessage("page-message", `${students.length} students found.`);

        const table = document.createElement("table");
        table.innerHTML = `
            <thead>
                <tr><th>ID</th><th>Name</th><th>Skills</th></tr>
            </thead>`;

        const tbody = document.createElement("tbody");

        students.forEach(student => {
            const tr = document.createElement("tr");

            [student.student_id, student.full_name, student.skills]
                .forEach(value => {
                    const td = document.createElement("td");
                    td.textContent = value ?? "";
                    tr.append(td);
                });

            tbody.append(tr);
        });

        table.append(tbody);
        document.getElementById("student-list").append(table);

    } catch (error) {
        showMessage("page-message", error.message, true);
    }
}

// ---------- PROJECT DIRECTORY ----------

async function showProjects() {
    setPage("Projects", "projects");

    content.innerHTML = `
        <section class="panel">
            <h2>Available projects</h2>
            <p id="project-page-message" class="message">Loading projects...</p>
            <div id="project-list" class="table-wrap"></div>
        </section>`;

    try {
        const projects = await api("/api/projects/details");

        showMessage(
            "project-page-message",
            `${projects.length} projects found.`
        );

        const table = document.createElement("table");
        table.innerHTML = `
            <thead>
                <tr>
                    <th>ID</th><th>Project</th><th>Status</th>
                    <th>Maximum team size</th>
                </tr>
            </thead>`;

        const tbody = document.createElement("tbody");

        projects.forEach(project => {
            const tr = document.createElement("tr");

            [
                project.project_id,
                project.title,
                project.status,
                project.team_size_max
            ].forEach(value => {
                const td = document.createElement("td");
                td.textContent = value ?? "—";
                tr.append(td);
            });

            tbody.append(tr);
        });

        table.append(tbody);
        document.getElementById("project-list").append(table);

    } catch (error) {
        showMessage("project-page-message", error.message, true);
    }
}

// ---------- DISCOVER PROJECTS ----------

async function showDiscoverProjects() {
    setPage("Discover Projects", "discover");

    content.innerHTML = `
        <section class="panel">
            <p class="eyebrow">OPPORTUNITIES</p>
            <h2>Discover Projects</h2>
            <p id="discover-message" class="message">Loading projects...</p>
            <div id="discover-list" class="matches"></div>
        </section>`;

    try {
        const projects = await api("/api/discover/projects", {}, true);
        const list = document.getElementById("discover-list");

        if (projects.length === 0) {
            showMessage("discover-message", "No open projects are available.");
            return;
        }

        showMessage(
            "discover-message",
            `${projects.length} open projects found.`
        );

        projects.forEach(project => {
            const card = document.createElement("article");
            card.className = "panel";

            const title = document.createElement("h2");
            title.textContent = project.title;

            const description = document.createElement("p");
            description.textContent =
                project.description || "No description provided.";

            const details = document.createElement("p");
            details.textContent =
                `Domain: ${project.domain} · Owner: ${project.owner_name} · Team size: ${project.team_size_min}–${project.team_size_max}`;

            const status = document.createElement("p");
            status.className = "message";
            status.textContent = project.already_applied
                ? "You have already applied to this project."
                : "Applications are open.";

            const button = document.createElement("button");
            button.className = "primary-button";
            button.textContent = project.already_applied
                ? "Already applied"
                : "Apply to project";
            button.disabled = project.already_applied;

            button.addEventListener("click", async () => {
                button.disabled = true;
                showMessage("discover-message", "Submitting application...");

                try {
                    await api("/api/applications", {
                        method: "POST",
                        body: JSON.stringify({
                            project_id: project.project_id
                        })
                    }, true);

                    status.textContent =
                        "Application submitted — Pending review.";
                    button.textContent = "Application submitted";

                    showMessage(
                        "discover-message",
                        "Your application was saved."
                    );

                } catch (error) {
                    status.textContent = error.message;
                    button.disabled = false;
                    showMessage("discover-message", error.message, true);
                }
            });

            card.append(title, description, details, status, button);
            list.append(card);
        });

    } catch (error) {
        showMessage("discover-message", error.message, true);

        if (/token|log in|unauthorized/i.test(error.message)) {
            logout();
        }
    }
}

// ---------- MY APPLICATIONS ----------

async function showMyApplications() {
    setPage("My Applications", "applications");

    content.innerHTML = `
        <section class="panel">
            <p class="eyebrow">YOUR ACTIVITY</p>
            <h2>My Applications</h2>
            <p id="applications-message" class="message">
                Loading applications...
            </p>
            <div id="applications-list" class="table-wrap"></div>
        </section>`;

    try {
        const applications = await api("/api/applications/mine", {}, true);
        const list = document.getElementById("applications-list");

        if (applications.length === 0) {
            showMessage(
                "applications-message",
                "You haven't applied to any projects yet."
            );
            return;
        }

        showMessage(
            "applications-message",
            `${applications.length} application(s) found.`
        );

        const table = document.createElement("table");
        table.innerHTML = `
            <thead>
                <tr><th>Project</th><th>Status</th><th>Applied at</th></tr>
            </thead>`;

        const tbody = document.createElement("tbody");

        applications.forEach(application => {
            const row = document.createElement("tr");

            [
                application.project_title,
                application.status,
                new Date(application.applied_at).toLocaleString()
            ].forEach(value => {
                const cell = document.createElement("td");
                cell.textContent = value ?? "—";
                row.append(cell);
            });

            tbody.append(row);
        });

        table.append(tbody);
        list.append(table);

    } catch (error) {
        showMessage("applications-message", error.message, true);

        if (/token|log in|unauthorized/i.test(error.message)) {
            logout();
        }
    }
}

// ---------- NAVIGATION ----------

document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", async () => {
        const page = button.dataset.page;

        try {
            if (page === "dashboard") {
                await loadDashboard();

            } else if (page === "students") {
                await showStudents();

            } else if (page === "projects") {
                await showProjects();

            } else if (page === "profile") {
                if (getToken()) {
                    await showProfile();
                } else {
                    showLogin("Log in to view your profile.");
                }

            } else if (page === "discover") {
                if (getToken()) {
                    await showDiscoverProjects();
                } else {
                    showLogin("Log in to discover and apply to projects.");
                }

            } else if (page === "applications") {
                if (getToken()) {
                    await showMyApplications();
                } else {
                    showLogin("Log in to view your applications.");
                }
            } else if (page === "review") {
                if (getToken()) {
                    await showOwnedApplications();
                } else {
                    showLogin("Log in to review your project applications.");
                }
            }
            else if (page === "my-projects") {
    await showMyProjects();
}
        } catch (error) {
            console.error("Navigation error:", error);
        }
        
    });
    
});

// ---------- LOGOUT AND INITIAL PAGE ----------

document.getElementById("logout-button")
    .addEventListener("click", logout);

updateAuthStatus();

if (getToken()) {
    showProfile();
} else {
    loadDashboard();
}


async function showOwnedApplications() {
    setPage("Review Applications", "review");

    content.innerHTML = `
        <section class="panel">
            <p class="eyebrow">PROJECT MANAGEMENT</p>
            <h2>Review Applications</h2>
            <p id="review-message" class="message" aria-live="polite">
                Loading your projects...
            </p>
            <div id="review-projects" class="matches"></div>
        </section>
    `;

    const message = document.getElementById("review-message");
    const container = document.getElementById("review-projects");

    try {
        // Get the currently logged-in student.
        const me = await api("/api/auth/me", {}, true);

        // Get projects, including their owner IDs.
        const allProjects = await api("/api/projects/details");

        if (!Array.isArray(allProjects)) {
            throw new Error(
                "The projects endpoint did not return a project list."
            );
        }

        // Only show projects created by this logged-in student.
        const ownedProjects = allProjects.filter(project =>
            Number(project.created_by) === Number(me.student_id)
        );

        if (ownedProjects.length === 0) {
            message.textContent =
                "You don't own any projects yet. Create a project first to review applications.";

            const discoverButton = document.createElement("button");
            discoverButton.type = "button";
            discoverButton.className = "primary-button";
            discoverButton.textContent = "Discover Projects";

            discoverButton.addEventListener("click", () => {
                showDiscoverProjects();
            });

            container.append(discoverButton);
            return;
        }

        message.textContent =
            `${ownedProjects.length} project(s) owned by you.`;

        for (const project of ownedProjects) {
            const card = document.createElement("section");
            card.className = "panel";

            const heading = document.createElement("h3");
            heading.textContent = project.title;

            const projectInfo = document.createElement("p");
            projectInfo.textContent =
                `Project status: ${project.status || "Unknown"}`;

            const status = document.createElement("p");
            status.className = "message";
            status.textContent = "Loading applications...";

            const applicantList = document.createElement("div");
            applicantList.className = "matches";

            card.append(heading, projectInfo, status, applicantList);
            container.append(card);

            try {
                const result = await api(
                    `/api/projects/${encodeURIComponent(project.project_id)}/applications`,
                    {},
                    true
                );

                const applications = Array.isArray(result)
                    ? result
                    : result.applications;

                if (!Array.isArray(applications)) {
                    throw new Error(
                        "The applications endpoint did not return an application list."
                    );
                }

                status.textContent =
                    `${applications.length} application(s)`;

                if (applications.length === 0) {
                    const empty = document.createElement("p");
                    empty.className = "message";
                    empty.textContent =
                        "No applications yet. Applications from other students will appear here.";
                    applicantList.append(empty);
                    continue;
                }

                applications.forEach(application => {
                    const applicant = document.createElement("article");
                    applicant.className = "match-card";

                    const details = document.createElement("div");

                    const name = document.createElement("h4");
                    name.textContent =
                        application.applicant_name || "Unknown student";

                    const email = document.createElement("p");
                    email.textContent = application.applicant_email || "";

                    const skills = document.createElement("p");
                    const skillList = Array.isArray(application.skills)
                        ? application.skills
                        : [];

                    skills.textContent =
                        "Skills: " +
                        (skillList.join(", ") || "Not listed");

                    const applicationStatus = document.createElement("p");
                    applicationStatus.className = "message";
                    applicationStatus.textContent =
                        `Application status: ${application.status}`;

                    details.append(name, email, skills, applicationStatus);
                    applicant.append(details);

                    if (application.status === "Pending") {
                        const actions = document.createElement("div");
                        actions.className = "match-controls";

                        for (const decision of ["Accepted", "Rejected"]) {
                            const button = document.createElement("button");
                            button.type = "button";
                            button.className = "primary-button";
                            button.textContent = decision;

                            button.addEventListener("click", async () => {
                                const confirmed = window.confirm(
                                    `Are you sure you want to ${decision.toLowerCase()} this application?`
                                );

                                if (!confirmed) return;

                                actions.querySelectorAll("button")
                                    .forEach(item => {
                                        item.disabled = true;
                                    });

                                try {
                                    await api(
                                        `/api/applications/${encodeURIComponent(application.application_id)}/review`,
                                        {
                                            method: "PUT",
                                            body: JSON.stringify({
                                                status: decision
                                            })
                                        },
                                        true
                                    );

                                    applicationStatus.textContent =
                                        `Application status: ${decision}`;

                                    actions.remove();

                                    showMessage(
                                        "review-message",
                                        `Application ${decision.toLowerCase()} successfully.`
                                    );
                                } catch (error) {
                                    applicationStatus.textContent =
                                        `Could not update application: ${error.message}`;

                                    applicationStatus.classList.add(
                                        "error-message"
                                    );

                                    actions.querySelectorAll("button")
                                        .forEach(item => {
                                            item.disabled = false;
                                        });
                                }
                            });

                            actions.append(button);
                        }

                        applicant.append(actions);
                    }

                    applicantList.append(applicant);
                });
            } catch (error) {
                status.textContent =
                    `Could not load applications: ${error.message}`;
                status.classList.add("error-message");
            }
        }
    } catch (error) {
        message.textContent =
            `Could not load your projects: ${error.message}`;
        message.classList.add("error-message");

        if (/token|log in|unauthorized|401/i.test(error.message)) {
            logout();
        }
    }
}



async function showMyProjects() {
    if (!getToken()) {
        showLogin("Log in to manage your projects.");
        return;
    }

    setPage("My Projects", "my-projects");

    content.innerHTML = `
        <section class="panel">
            <p class="eyebrow">PROJECT MANAGEMENT</p>
            <h2>Create a Project</h2>
            <p id="my-projects-message" class="message"></p>

            <form id="my-project-form" class="auth-form">
                <label for="mp-title">Project title</label>
                <input id="mp-title" required minlength="3"
                    maxlength="200">

                <label for="mp-description">Description</label>
                <textarea id="mp-description" required
                    minlength="10" maxlength="5000"></textarea>

                <label for="mp-type">Project type</label>
                <input id="mp-type" value="Academic" required>

                <label for="mp-domain">Domain</label>
                <input id="mp-domain" required
                    placeholder="e.g. Web Development">

                <label for="mp-min">Minimum team size</label>
                <input id="mp-min" type="number" min="1"
                    max="100" value="2" required>

                <label for="mp-max">Maximum team size</label>
                <input id="mp-max" type="number" min="1"
                    max="100" value="4" required>

                <label for="mp-deadline">Deadline</label>
                <input id="mp-deadline" type="date">

                <button class="primary-button" type="submit">
                    Create Project
                </button>
            </form>
        </section>

        <section class="panel">
            <h2>Projects You Own</h2>
            <div id="my-projects-list" class="matches">
                Loading your projects...
            </div>
        </section>
    `;

    const message = document.getElementById("my-projects-message");
    const list = document.getElementById("my-projects-list");

    async function loadOwnedProjects() {
        const [me, projects] = await Promise.all([
            api("/api/auth/me", {}, true),
            api("/api/projects/details")
        ]);

        list.replaceChildren();

        const mine = projects.filter(
            project =>
                Number(project.created_by) === Number(me.student_id)
        );

        if (!mine.length) {
            list.textContent = "You haven't created any projects yet.";
            return;
        }

        mine.forEach(project => {
            const card = document.createElement("article");
            card.className = "match-card";

            const details = document.createElement("div");
            const title = document.createElement("h3");
            title.textContent = project.title;

            const description = document.createElement("p");
            description.textContent = project.description || "";

            const info = document.createElement("p");
            info.textContent =
                `Domain: ${project.domain} · Status: ${project.status} · ` +
                `Team size: ${project.team_size_min}–${project.team_size_max}`;

            details.append(title, description, info);

            const actions = document.createElement("div");
            actions.className = "match-controls";

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "primary-button";
            edit.textContent = "Edit";

            edit.addEventListener("click", async () => {
                const updated = {
                    title: prompt("Project title:", project.title),
                    description: prompt(
                        "Project description:", project.description || ""
                    ),
                    project_type: prompt(
                        "Project type:", project.project_type
                    ),
                    domain: prompt("Domain:", project.domain),
                    team_size_min: prompt(
                        "Minimum team size:", project.team_size_min
                    ),
                    team_size_max: prompt(
                        "Maximum team size:", project.team_size_max
                    ),
                    deadline: prompt(
                        "Deadline (YYYY-MM-DD; leave blank for none):",
                        project.deadline || ""
                    )
                };

                if (Object.values(updated).some(v => v === null)) {
                    return;
                }

                updated.team_size_min = Number(updated.team_size_min);
                updated.team_size_max = Number(updated.team_size_max);
                updated.deadline = updated.deadline || null;

                try {
                    await api(`/api/projects/${project.project_id}`, {
                        method: "PUT",
                        body: JSON.stringify(updated)
                    }, true);

                    await loadOwnedProjects();
                    showMessage(
                        "my-projects-message",
                        "Project updated successfully."
                    );
                } catch (error) {
                    showMessage("my-projects-message", error.message, true);
                }
            });

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "primary-button";
            remove.textContent = "Delete";

            remove.addEventListener("click", async () => {
                if (!confirm(
                    `Delete "${project.title}"? This cannot be undone.`
                )) {
                    return;
                }

                try {
                    await api(`/api/projects/${project.project_id}`, {
                        method: "DELETE"
                    }, true);

                    await loadOwnedProjects();
                    showMessage(
                        "my-projects-message",
                        "Project deleted successfully."
                    );
                } catch (error) {
                    showMessage("my-projects-message", error.message, true);
                }
            });

            actions.append(edit, remove);
            card.append(details, actions);
            list.append(card);
        });
    }

    document.getElementById("my-project-form")
        .addEventListener("submit", async event => {
            event.preventDefault();

            const button = event.submitter;
            button.disabled = true;

            const data = {
                title: document.getElementById("mp-title").value.trim(),
                description: document.getElementById("mp-description").value.trim(),
                project_type: document.getElementById("mp-type").value.trim(),
                domain: document.getElementById("mp-domain").value.trim(),
                team_size_min: Number(document.getElementById("mp-min").value),
                team_size_max: Number(document.getElementById("mp-max").value),
                deadline: document.getElementById("mp-deadline").value || null
            };

            try {
                await api("/api/projects", {
                    method: "POST",
                    body: JSON.stringify(data)
                }, true);

                event.target.reset();
                document.getElementById("mp-type").value = "Academic";
                document.getElementById("mp-min").value = 2;
                document.getElementById("mp-max").value = 4;

                showMessage(
                    "my-projects-message",
                    "Project created successfully."
                );

                await loadOwnedProjects();
            } catch (error) {
                showMessage("my-projects-message", error.message, true);
            } finally {
                button.disabled = false;
            }
        });

    try {
        await loadOwnedProjects();
    } catch (error) {
        showMessage("my-projects-message", error.message, true);
        list.textContent = "Could not load your projects.";
    }
}
