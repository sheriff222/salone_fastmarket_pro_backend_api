import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';

import '../../services/message_service.dart';
import '../login_screen/provider/user_provider.dart';

class MessageController extends GetxController {
  final MessageService _messageService = MessageService();
  final TextEditingController messageTextController = TextEditingController();

  // Observables
  var messages = <Map<String, dynamic>>[].obs;
  var isLoading = false.obs;
  var isSending = false.obs;
  var hasMoreMessages = true.obs;
  var currentPage = 1.obs;

  // Chat info
  var receiverId = ''.obs;
  var receiverName = ''.obs;
  var productId = ''.obs;
  var productName = ''.obs;
  var conversationId = ''.obs;

  @override
  void onInit() {
    super.onInit();
    ever(messages, (_) => scrollToBottom());
  }

  @override
  void onClose() {
    messageTextController.dispose();
    super.onClose();
  }

  // Initialize chat
  void initializeChat({
    required String receiverId,
    required String receiverName,
    String? productId,
    String? productName,
  }) {
    this.receiverId.value = receiverId;
    this.receiverName.value = receiverName;
    this.productId.value = productId ?? '';
    this.productName.value = productName ?? '';

    final currentUserId = getCurrentUserId();
    if (currentUserId.isNotEmpty) {
      conversationId.value = _messageService.generateConversationId(currentUserId, receiverId);
      loadMessages();
    }
  }

  // Get current user info
  String getCurrentUserId() {
    try {
      final userProvider = Get.context != null
          ? Provider.of<UserProvider>(Get.context!, listen: false)
          : null;
      final currentUser = userProvider?.getLoginUsr();
      return currentUser?.id ?? '';
    } catch (e) {
      print('Error getting current user ID: $e');
      return '';
    }
  }

  String getCurrentUserName() {
    try {
      final userProvider = Get.context != null
          ? Provider.of<UserProvider>(Get.context!, listen: false)
          : null;
      final currentUser = userProvider?.getLoginUsr();
      return currentUser?.name  ?? 'You';
    } catch (e) {
      print('Error getting current user name: $e');
      return 'You';
    }
  }

  // Load messages
  Future<void> loadMessages({bool loadMore = false}) async {
    final currentUserId = getCurrentUserId();
    if (currentUserId.isEmpty || receiverId.value.isEmpty) return;

    if (!loadMore) {
      isLoading.value = true;
      currentPage.value = 1;
      messages.clear();
    }

    final result = await _messageService.getConversation(
      currentUserId,
      receiverId.value,
      page: currentPage.value,
      limit: 30,
    );

    if (result['success']) {
      final data = result['data'];
      final newMessages = List<Map<String, dynamic>>.from(data['messages'] ?? []);

      if (loadMore) {
        // Add older messages to the beginning
        messages.insertAll(0, newMessages);
      } else {
        messages.value = newMessages;
      }

      hasMoreMessages.value = data['hasMore'] ?? false;
      currentPage.value++;

      // Mark messages as read
      markAsRead();
    }

    isLoading.value = false;
  }

  // Send message
  Future<void> sendMessage() async {
    final messageText = messageTextController.text.trim();
    if (messageText.isEmpty || isSending.value) return;

    final currentUserId = getCurrentUserId();
    if (currentUserId.isEmpty) {
      Get.snackbar('Error', 'Please login to send messages');
      return;
    }

    isSending.value = true;

    // Optimistically add message to UI
    final tempMessage = {
      '_id': DateTime.now().millisecondsSinceEpoch.toString(),
      'message': messageText,
      'senderId': {'_id': currentUserId, 'fullName': getCurrentUserName()},
      'receiverId': {'_id': receiverId.value, 'fullName': receiverName.value},
      'createdAt': DateTime.now().toIso8601String(),
      'isTemp': true, // Flag for temporary message
    };

    messages.add(tempMessage);
    messageTextController.clear();
    scrollToBottom();

    final result = await _messageService.sendMessage(
      senderId: currentUserId,
      receiverId: receiverId.value,
      message: messageText,
      productId: productId.value.isEmpty ? null : productId.value,
    );

    // Remove temp message
    messages.removeWhere((msg) => msg['_id'] == tempMessage['_id']);

    if (result['success']) {
      // Add the real message from server
      messages.add(result['data']);
      Get.snackbar('Success', 'Message sent successfully');
    } else {
      Get.snackbar('Error', result['message'] ?? 'Failed to send message');
    }

    isSending.value = false;
    scrollToBottom();
  }

  // Mark messages as read
  Future<void> markAsRead() async {
    if (conversationId.value.isNotEmpty) {
      await _messageService.markMessagesAsRead(
        conversationId.value,
        getCurrentUserId(),
      );
    }
  }

  // Load more messages (for pagination)
  void loadMoreMessages() {
    if (hasMoreMessages.value && !isLoading.value) {
      loadMessages(loadMore: true);
    }
  }

  // Scroll to bottom
  final ScrollController scrollController = ScrollController();

  void scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (scrollController.hasClients) {
        scrollController.animateTo(
          scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  // Check if message is from current user
  bool isMyMessage(Map<String, dynamic> message) {
    final currentUserId = getCurrentUserId();
    return message['senderId']['_id'] == currentUserId;
  }

  // Format message time
  String formatMessageTime(String? dateString) {
    if (dateString == null) return '';
    try {
      final date = DateTime.parse(dateString);
      final now = DateTime.now();
      final today = DateTime(now.year, now.month, now.day);
      final messageDate = DateTime(date.year, date.month, date.day);

      if (messageDate == today) {
        return '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
      } else if (messageDate == today.subtract(const Duration(days: 1))) {
        return 'Yesterday ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
      } else {
        return '${date.day}/${date.month}/${date.year}';
      }
    } catch (e) {
      return '';
    }
  }

  // Get seller info for product
  Future<void> loadSellerInfo(String productId) async {
    final result = await _messageService.getSellerInfo(productId);
    if (result['success']) {
      final data = result['data'];
      receiverId.value = data['sellerId'];
      receiverName.value = data['sellerName'];
      productName.value = data['productName'];

      initializeChat(
        receiverId: data['sellerId'],
        receiverName: data['sellerName'],
        productId: productId,
        productName: data['productName'],
      );
    }
  }
}