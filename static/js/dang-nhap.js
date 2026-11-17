/* global jQuery */
(() => {
  if (!window.jQuery) return;

  const $ = jQuery;

  $('#login-form, #register-form').on('submit', function (event) {
    event.preventDefault();

    const isRegistration = this.id === 'register-form';
    const $message = $(this).find('.form-message');

    if (isRegistration && $('#register-password').val() !== $('#register-confirm').val()) {
      $message.addClass('text-danger').text('Hai mật khẩu chưa khớp.');
      $('#register-confirm').trigger('focus');
      return;
    }

    const action = isRegistration ? 'đăng ký' : 'đăng nhập';
    $(this).find('input[type="password"]').val('');
    $message.removeClass('text-danger').text('Biểu mẫu hợp lệ. Tính năng ' + action + ' đang ở chế độ xem thử.');
  });

  $('#login-link').on('click', function (event) {
    event.preventDefault();
    $('#login-name').trigger('focus');
  });

  $('.library-notice').prop('hidden', true);
  $('.form-stack button[type="submit"]').prop('disabled', false);
})();
