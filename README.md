# Bộ sưu tập Zippo

Web xem và quản lý bộ sưu tập Zippo, chạy trên máy tính và điện thoại, có icon riêng trên Android.

- **Dữ liệu:** Google Sheet "My collection" của anh. Web đọc sheet **Data Zippo**; thêm/sửa thì ghi vào sheet **Zippo**.
- **Ảnh:** thư mục **Anh Zippo** trên Google Drive, đặt tên theo No. Web nhận các kiểu: `12 (1).jpg`, `12 (2).jpg`, `12(3).jpg`… (kiểu đổi tên hàng loạt của Windows), hoặc `12.jpg`, `12_2.jpg`. Ảnh có số nhỏ nhất là ảnh chính.
- **Khách** chỉ thấy tên, SKU, Case, Finish, Code, Code Year và ảnh.
- **Chủ** (sau khi nhập mật khẩu) thấy thêm giá, ngày mua, tình trạng, nơi mua, xuất xứ, ghi chú, và được thêm/sửa/xoá.

---

## Cài phần máy chủ (làm một lần, khoảng 10 phút)

### 1. Tạo Apps Script
1. Mở Google Sheet **My collection**.
2. Menu **Tiện ích mở rộng → Apps Script** (*Extensions → Apps Script*).
3. Xoá hết chữ có sẵn trong ô soạn thảo, rồi dán toàn bộ nội dung file [`apps-script/Code.gs`](apps-script/Code.gs).
4. Ở dòng `const OWNER_PASSWORD = 'DOI-MAT-KHAU-O-DAY';`, thay chữ `DOI-MAT-KHAU-O-DAY` bằng mật khẩu anh muốn (giữ nguyên hai dấu nháy `'`).
5. Bấm biểu tượng 💾 **Lưu**.

### 2. Chạy cài đặt lần đầu
1. Ở thanh trên cùng, chọn hàm **setup** rồi bấm **▶ Chạy** (*Run*).
2. Google hỏi quyền: bấm **Xem xét quyền** → chọn tài khoản của anh → **Nâng cao** (*Advanced*) → **Đi tới … (không an toàn)** → **Cho phép**.
   (Cảnh báo này xuất hiện vì script do chính anh tạo, chưa qua Google duyệt. Script chỉ chạy dưới tài khoản của anh.)
3. Chạy xong, sheet sẽ có thêm tab **Danh mục** (danh sách Case, Finish, Tình trạng cho form thêm mới — anh tự sửa được), và thư mục ảnh được bật "ai có link thì xem được" để web hiện ảnh.

### 3. Triển khai thành Web app
1. Bấm **Triển khai → Tùy chọn triển khai mới** (*Deploy → New deployment*).
2. Bấm biểu tượng ⚙ cạnh "Chọn loại" → chọn **Ứng dụng web** (*Web app*).
3. **Thực thi dưới dạng:** *Tôi* (Me). **Người có quyền truy cập:** *Bất kỳ ai* (Anyone).
4. Bấm **Triển khai**, rồi **sao chép đường link Web app** (kết thúc bằng `/exec`) và gửi cho em.

> Sau này nếu sửa `Code.gs`, vào **Triển khai → Quản lý triển khai → ✏ Sửa → Phiên bản: Phiên bản mới → Triển khai** để giữ nguyên đường link.

### 4. Bật GitHub Pages
1. Vào repo `zippo-collection` trên GitHub → **Settings → Pages**.
2. Mục *Build and deployment*: Source = **Deploy from a branch**, Branch = **main**, thư mục **/(root)** → **Save**.
3. Khoảng 1 phút sau, web có ở địa chỉ: `https://hunter2811-cyber.github.io/zippo-collection/`

---

## Dùng hằng ngày

- **Đăng nhập chế độ chủ:** bấm biểu tượng ổ khoá góc trên phải, nhập mật khẩu. Máy đó sẽ nhớ; bấm lại ổ khoá để thoát.
- **Chia sẻ cho bạn bè:** gửi đường link web. Người khác chỉ xem được ở chế độ khách.
- **Gửi link một chiếc cụ thể:** mở chiếc đó, rồi sao chép đường link trên trình duyệt (có dạng `…/#no=12`).
- **Thêm Zippo:** bấm **Thêm Zippo**, điền thông tin, chọn ảnh từ máy ảnh, bấm Lưu. Ảnh được tự thu nhỏ và lưu vào thư mục Anh Zippo.
- **Thêm ảnh trực tiếp trên Drive:** trên Windows, chọn hết ảnh của một chiếc → bấm F2 → gõ số No. (VD `125`) → Enter, Windows tự đặt `125 (1).jpg`, `125 (2).jpg`… Chép vào thư mục **Anh Zippo**, web hiện ảnh trong vòng 2 phút.
- **Vẫn nhập trên Google Sheet như cũ được:** nhập thêm dòng vào sheet Zippo, web tự cập nhật lần mở sau.
- **Sửa danh sách Case/Finish trong form thêm mới:** sửa tab **Danh mục** trong Google Sheet.
- **Bộ lọc** Case/Finish/Code Year/Năm mua tự lấy theo dữ liệu thật trong sheet, nên khi anh chuẩn hoá tên Finish trong sheet thì bộ lọc tự gọn lại.

## Cài icon lên điện thoại Android
1. Mở web bằng **Chrome** trên điện thoại.
2. Bấm **⋮ → Thêm vào màn hình chính** (hoặc **Cài đặt ứng dụng**).
3. Icon Zippo xuất hiện trên màn hình chính, mở ra toàn màn hình như một ứng dụng.

## Sao lưu
- Dữ liệu nằm trong Google Sheet, Google tự lưu lịch sử: **Tệp → Nhật ký phiên bản**.
- Ảnh xoá trên web được chuyển vào **Thùng rác Drive** (khôi phục được trong 30 ngày).
- Nên thỉnh thoảng **Tệp → Tải xuống → Microsoft Excel** để giữ một bản trên máy.

---

## Cấu trúc
| File | Vai trò |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | Giao diện web |
| `config.js` | Đường link Apps Script |
| `manifest.webmanifest`, `sw.js`, `icons/` | Icon và cài như ứng dụng |
| `apps-script/Code.gs` | Phần máy chủ chạy trên Google (đọc/ghi Sheet, ảnh Drive) |
