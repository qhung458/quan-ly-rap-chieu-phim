/* global jQuery */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;

  $('#login-form, #register-form').on('submit', async function (event) {
    event.preventDefault();
    const isRegistration = this.id === 'register-form';
    const $message = $(this).find('.form-message');
    const $submit = $(this).find('button[type="submit"]');
    const payload = Object.fromEntries(new FormData(this));

    $message.empty().removeClass('text-danger');
    if (isRegistration && payload.MatKhau !== payload.XacNhanMatKhau) {
      $message.addClass('text-danger').text('Hai mật khẩu chưa khớp.');
      $('#register-confirm').trigger('focus');
      return;
    }

    $submit.prop('disabled', true);
    try {
      await $.ajax({
        url: '/api/auth/' + (isRegistration ? 'register' : 'login'),
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(payload)
      });
      if (isRegistration) {
        this.reset();
        window.authToast.show('Đăng ký thành công');
        $('#login-name').val(payload.TenDangNhap).trigger('focus');
      } else {
        window.authToast.queue('Đăng nhập thành công');
        location.assign('phim-va-suatchieu.html#phim');
      }
    } catch (xhr) {
      $message.addClass('text-danger')
        .text(xhr.responseJSON?.message || 'Không gửi được biểu mẫu. Kiểm tra máy chủ.');
    } finally {
      $submit.prop('disabled', false);
    }
  });

  $('#login-link').on('click', event => {
    event.preventDefault();
    $('#login-name').trigger('focus');
  });

  $('.library-notice').prop('hidden', true);
  $('.form-stack button[type="submit"]').prop('disabled', false);
})();
