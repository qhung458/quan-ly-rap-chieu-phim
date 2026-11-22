// -------------------- DỮ LIỆU --------------------

// Dữ liệu phim và suất chiếu được lấy từ MySQL.
let movies = [];
let showtimes = [];

let selectedMovieId = null;
let selectedShowtimeId = null;

// Tải danh sách phim từ MySQL.
async function loadMoviesFromAPI() {
    try {
        const response = await fetch("/api/phim");

        if (!response.ok) {
            throw new Error("Không thể tải danh sách phim.");
        }

        const data = await response.json();

        movies = data.map(item => ({
            id: item.MaPhim,
            name: item.TenPhim,
            genre: item.TheLoai,
            director: item.DaoDien || "",
            duration: item.ThoiLuong,
            date: item.NgayKhoiChieu,
            age: String(item.DoTuoiChoPhep)
        }));

        renderMovies();
    } catch (error) {
        console.error(error);
        alert("Không thể tải danh sách phim từ máy chủ.");
    }
}

function formatDate(value) {
    if (!value) return "";
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
}

// -------------------- ĐIỀU HƯỚNG --------------------
document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
        button.classList.add("active");

        const page = button.dataset.page;
        document.getElementById("moviesPage").classList.toggle("hidden", page !== "movies");
        document.getElementById("showtimesPage").classList.toggle("hidden", page !== "showtimes");
        document.getElementById("placeholderPage").classList.toggle("hidden", page === "movies" || page === "showtimes");

        if (page !== "movies" && page !== "showtimes") {
            document.getElementById("placeholderTitle").textContent = button.textContent.trim();
        }
    });
});

// -------------------- QUẢN LÝ PHIM --------------------
const movieForm = document.getElementById("movieForm");
const movieFields = {
    id: document.getElementById("movieId"),
    name: document.getElementById("movieName"),
    genre: document.getElementById("movieGenre"),
    director: document.getElementById("movieDirector"),
    duration: document.getElementById("movieDuration"),
    date: document.getElementById("movieDate"),
    age: document.getElementById("movieAge")
};
function renderMovies(list = movies) {
    const tbody = document.getElementById("movieTable");

    tbody.innerHTML = list.map(movie => `
        <tr data-id="${escapeHTML(movie.id)}" class="${selectedMovieId === movie.id ? "selected" : ""}">
            <td>${escapeHTML(movie.id)}</td>
            <td>${escapeHTML(movie.name)}</td>
            <td>${escapeHTML(movie.genre)}</td>
            <td>${escapeHTML(movie.director)}</td>
            <td>${escapeHTML(movie.duration)} phút</td>
            <td>${formatDate(movie.date)}</td>
            <td>${Number(movie.age) === 0 ? "P" : "T" + escapeHTML(movie.age)}</td>
        </tr>
    `).join("");

    tbody.querySelectorAll("tr").forEach(row => {
        row.addEventListener("click", () => selectMovie(row.dataset.id));
    });

    updateMovieSelects();
}

function selectMovie(id) {
    const movie = movies.find(item => item.id === id);
    if (!movie) return;
    selectedMovieId = id;
    Object.keys(movieFields).forEach(key => movieFields[key].value = movie[key]);
    renderMovies(getFilteredMovies());
}

function getFilteredMovies() {
    const name = document.getElementById("searchMovieName").value.trim().toLowerCase();
    const genre = document.getElementById("searchMovieGenre").value;

    return movies.filter(movie =>
        movie.name.toLowerCase().includes(name) &&
        (!genre || movie.genre.includes(genre))
    );
}

function resetMovieForm() {
    movieForm.reset();
    movieFields.id.disabled = false;
    selectedMovieId = null;
    renderMovies(getFilteredMovies());
}

document.getElementById("addMovie").addEventListener("click", () => {
    resetMovieForm();
    movieFields.id.focus();
});

movieForm.addEventListener("submit", async event => {
    event.preventDefault();

    const movie = {
        MaPhim: movieFields.id.value.trim(),
        TenPhim: movieFields.name.value.trim(),
        TheLoai: movieFields.genre.value.trim(),
        DaoDien: movieFields.director.value.trim(),
        ThoiLuong: Number(movieFields.duration.value),
        NgayKhoiChieu: movieFields.date.value,
        DoTuoiChoPhep: Number(movieFields.age.value)
    };

    const isEditing = Boolean(selectedMovieId);

    const url = isEditing
        ? `/api/phim/${encodeURIComponent(selectedMovieId)}`
        : "/api/phim";

    const method = isEditing ? "PUT" : "POST";

    try {
        const response = await fetch(url, {
            method: method,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(movie)
        });

        const result = await response.json();

        if (!response.ok) {
            alert(result.message || "Không thể lưu thông tin phim.");
            return;
        }

        alert(isEditing ? "Cập nhật phim thành công!" : "Thêm phim thành công!");

        selectedMovieId = movie.MaPhim;

        await loadMoviesFromAPI();

        selectMovie(movie.MaPhim);

    } catch (error) {
        console.error(error);
        alert("Không thể kết nối đến máy chủ.");
    }
});

document.getElementById("editMovie").addEventListener("click", () => {
    if (!selectedMovieId) return alert("Vui lòng chọn một phim trong bảng trước khi sửa.");
    movieFields.id.disabled = true;
    movieFields.name.focus();
});

document.getElementById("deleteMovie").addEventListener("click", async () => {
    if (!selectedMovieId) {
        return alert("Vui lòng chọn phim cần xóa.");
    }
    if (!confirm("Bạn có chắc muốn xóa phim này?")) {
        return;
    }
    try {
        const response = await fetch(
            `/api/phim/${encodeURIComponent(selectedMovieId)}`,
            {
                method: "DELETE"
            }
        );
        const result = await response.json();
        if (!response.ok) {
            alert(result.message || "Không thể xóa phim.");
            return;
        }
        alert("Xóa phim thành công!");
        selectedMovieId = null;
        await loadMoviesFromAPI();
        resetMovieForm();
    } catch (error) {
        console.error(error);
        alert("Không thể kết nối đến máy chủ.");
    }
});

document.getElementById("resetMovie").addEventListener("click", resetMovieForm);
document.getElementById("searchMovie").addEventListener("click", () => renderMovies(getFilteredMovies()));
document.getElementById("clearMovieSearch").addEventListener("click", () => {
    document.getElementById("searchMovieName").value = "";
    document.getElementById("searchMovieGenre").value = "";
    document.getElementById("searchMovieStatus").value = "";
    renderMovies();
});


// -------------------- QUẢN LÝ SUẤT CHIẾU --------------------
const showtimeForm = document.getElementById("showtimeForm");

const showtimeFields = {
    id: document.getElementById("showtimeId"),
    movieId: document.getElementById("showtimeMovie"),
    room: document.getElementById("showtimeRoom"),
    date: document.getElementById("showtimeDate"),
    start: document.getElementById("showtimeStart"),
    end: document.getElementById("showtimeEnd"),
    price: document.getElementById("showtimePrice"),
    status: document.getElementById("showtimeStatus")
};

// Chuyển trạng thái giữa giao diện và cơ sở dữ liệu.
const showtimeStatusMap = {
    SapChieu: "Sắp chiếu",
    DangChieu: "Đang chiếu",
    KetThuc: "Kết thúc",
    Huy: "Hủy"
};

function getStatusCode(status) {
    const value = String(status ?? "").trim();

    if (showtimeStatusMap[value]) return value;

    const entry = Object.entries(showtimeStatusMap)
        .find(([, label]) => label === value);

    return entry ? entry[0] : value;
}

function getStatusLabel(status) {
    const code = getStatusCode(status);
    return showtimeStatusMap[code] || status;
}

function getStatusFormValue(status) {
    const code = getStatusCode(status);
    const label = getStatusLabel(code);
    const options = Array.from(showtimeFields.status.options);

    const matchingOption = options.find(option =>
        option.value === code || option.value === label
    );

    return matchingOption ? matchingOption.value : code;
}
// -------------------- TẢI DỮ LIỆU TỪ MYSQL --------------------
async function loadShowtimesFromAPI() {
    try {
        const response = await fetch("/api/suat-chieu");
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || "Không thể tải danh sách suất chiếu.");
        }

        showtimes = result.map(item => ({
            id: item.MaSuatChieu,
            movieId: item.MaPhim,
            room: item.MaPhong,
            date: item.NgayChieu,
            start: String(item.GioBatDau).slice(0, 5),
            end: String(item.GioKetThuc).slice(0, 5),
            price: Number(item.GiaVe),
            status: getStatusCode(item.TrangThai)
        }));

        renderShowtimes(getFilteredShowtimes());

    } catch (error) {
        console.error(error);
        alert(error.message || "Không thể kết nối đến máy chủ để tải suất chiếu.");
    }
}
// -------------------- CẬP NHẬT DANH SÁCH PHIM --------------------
function updateMovieSelects() {
    const selects = [
        document.getElementById("filterMovie"),
        showtimeFields.movieId
    ];

    const previousValues = selects.map(select => select.value);

    selects.forEach((select, index) => {
        const firstOption = index === 0
            ? '<option value="">--Tất cả phim--</option>'
            : '<option value="">--Chọn phim--</option>';

        select.innerHTML = firstOption + movies.map(movie =>
            `<option value="${escapeHTML(movie.id)}">${escapeHTML(movie.name)} (${escapeHTML(movie.id)})</option>`
        ).join("");

        if (movies.some(movie => movie.id === previousValues[index])) {
            select.value = previousValues[index];
        }
    });
}
// -------------------- TÍNH GIỜ KẾT THÚC --------------------
function calculateEndTime() {
    const movie = movies.find(item =>
        item.id === showtimeFields.movieId.value
    );

    const start = showtimeFields.start.value;

    if (!movie || !start) {
        showtimeFields.end.value = "";
        return;
    }

    const [hours, minutes] = start.split(":").map(Number);
    const total = hours * 60 + minutes + Number(movie.duration);

    const endHours = Math.floor(total / 60) % 24;
    const endMinutes = total % 60;

    showtimeFields.end.value =
        `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
}

showtimeFields.movieId.addEventListener("change", calculateEndTime);
showtimeFields.start.addEventListener("change", calculateEndTime);

// -------------------- HIỂN THỊ SUẤT CHIẾU --------------------

function renderShowtimes(list = showtimes) {
    const tbody = document.getElementById("showtimeTable");

    tbody.innerHTML = list.map(item => `
        <tr data-id="${escapeHTML(item.id)}"
            class="${selectedShowtimeId === item.id ? "selected" : ""}">
            <td>${escapeHTML(item.id)}</td>
            <td>${escapeHTML(item.movieId)}</td>
            <td>${escapeHTML(item.room)}</td>
            <td>${formatDate(item.date)}</td>
            <td>${escapeHTML(item.start)}</td>
            <td>${escapeHTML(item.end)}</td>
            <td>${Number(item.price).toLocaleString("vi-VN")}</td>
            <td>${escapeHTML(getStatusLabel(item.status))}</td>
        </tr>
    `).join("");

    tbody.querySelectorAll("tr").forEach(row => {
        row.addEventListener("click", () => {
            selectShowtime(row.dataset.id);
        });
    });
}
// -------------------- CHỌN SUẤT CHIẾU --------------------
function selectShowtime(id) {
    const item = showtimes.find(showtime => showtime.id === id);

    if (!item) return;

    selectedShowtimeId = id;

    showtimeFields.id.value = item.id;
    showtimeFields.movieId.value = item.movieId;
    showtimeFields.room.value = item.room;
    showtimeFields.date.value = item.date;
    showtimeFields.start.value = item.start;
    showtimeFields.end.value = item.end;
    showtimeFields.price.value = item.price;
    showtimeFields.status.value = getStatusFormValue(item.status);

    renderShowtimes(getFilteredShowtimes());
}
// -------------------- LỌC SUẤT CHIẾU --------------------
function getFilteredShowtimes() {
    const movieId = document.getElementById("filterMovie").value;
    const date = document.getElementById("filterDate").value;

    return showtimes.filter(item =>
        (!movieId || item.movieId === movieId) &&
        (!date || item.date === date)
    );
}
// -------------------- LÀM MỚI FORM --------------------
function resetShowtimeForm() {
    showtimeForm.reset();

    showtimeFields.id.disabled = false;
    showtimeFields.end.value = "";

    selectedShowtimeId = null;

    renderShowtimes(getFilteredShowtimes());
}
// -------------------- THÊM SUẤT CHIẾU --------------------
document.getElementById("addShowtime").addEventListener("click", () => {
    resetShowtimeForm();
    showtimeFields.id.focus();
});
// -------------------- THÊM / CẬP NHẬT SUẤT CHIẾU --------------------
showtimeForm.addEventListener("submit", async event => {
    event.preventDefault();

    calculateEndTime();

    const movie = movies.find(item =>
        item.id === showtimeFields.movieId.value
    );

    if (!movie) {
        return alert("Vui lòng chọn phim hợp lệ.");
    }

    const price = Number(showtimeFields.price.value);

    if (!Number.isFinite(price) || price <= 0) {
        return alert("Giá vé phải lớn hơn 0!");
    }

    const item = {
        MaSuatChieu: showtimeFields.id.value.trim(),
        MaPhim: showtimeFields.movieId.value,
        MaPhong: showtimeFields.room.value,
        NgayChieu: showtimeFields.date.value,
        GioBatDau: showtimeFields.start.value,
        GioKetThuc: showtimeFields.end.value,
        GiaVe: price,
        TrangThai: getStatusCode(showtimeFields.status.value)
    };

    if (item.GioKetThuc <= item.GioBatDau) {
        return alert("Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.");
    }

    const isEditing = Boolean(selectedShowtimeId);

    const url = isEditing
        ? `/api/suat-chieu/${encodeURIComponent(selectedShowtimeId)}`
        : "/api/suat-chieu";

    const method = isEditing ? "PUT" : "POST";

    try {
        const response = await fetch(url, {
            method,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(item)
        });

        const result = await response.json();

        if (!response.ok) {
            alert(result.message || "Không thể lưu thông tin suất chiếu.");
            return;
        }

        alert(isEditing
            ? "Cập nhật suất chiếu thành công!"
            : "Thêm suất chiếu thành công!");

        selectedShowtimeId = item.MaSuatChieu;

        await loadShowtimesFromAPI();

        selectShowtime(item.MaSuatChieu);

    } catch (error) {
        console.error(error);
        alert("Không thể kết nối đến máy chủ.");
    }
});
// -------------------- SỬA SUẤT CHIẾU --------------------
document.getElementById("editShowtime").addEventListener("click", () => {
    if (!selectedShowtimeId) {
        return alert("Vui lòng chọn suất chiếu trong bảng trước khi sửa.");
    }

    showtimeFields.id.disabled = true;
    showtimeFields.movieId.focus();
});
// -------------------- XÓA SUẤT CHIẾU --------------------
document.getElementById("deleteShowtime").addEventListener("click", async () => {
    if (!selectedShowtimeId) {
        return alert("Vui lòng chọn suất chiếu cần xóa.");
    }

    if (!confirm("Bạn có chắc muốn xóa suất chiếu này?")) {
        return;
    }

    try {
        const response = await fetch(
            `/api/suat-chieu/${encodeURIComponent(selectedShowtimeId)}`,
            {
                method: "DELETE"
            }
        );

        const result = await response.json();

        if (!response.ok) {
            alert(result.message || "Không thể xóa suất chiếu.");
            return;
        }

        alert("Xóa suất chiếu thành công!");

        selectedShowtimeId = null;

        await loadShowtimesFromAPI();

        resetShowtimeForm();

    } catch (error) {
        console.error(error);
        alert("Không thể kết nối đến máy chủ.");
    }
});
// -------------------- CÁC NÚT ĐIỀU KHIỂN --------------------
document.getElementById("resetShowtime").addEventListener("click", resetShowtimeForm);

document.getElementById("filterShowtimes").addEventListener("click", () => {
    renderShowtimes(getFilteredShowtimes());
});

document.getElementById("clearShowtimeFilter").addEventListener("click", () => {
    document.getElementById("filterMovie").value = "";
    document.getElementById("filterDate").value = "";

    renderShowtimes();
});
["accountLink", "backLink", "logoutLink"].forEach(id => {
    document.getElementById(id).addEventListener("click", event => {
        event.preventDefault();
    });
});


// -------------------- KHỞI TẠO GIAO DIỆN --------------------
async function initializeData() {
    await loadMoviesFromAPI();
    await loadShowtimesFromAPI();
}

initializeData();