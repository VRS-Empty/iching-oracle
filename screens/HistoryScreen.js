/**
 * screens/HistoryScreen.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Divination history log — lists all past casts stored in SQLite.
 *
 * Feature tiers:
 *   Free     — most recent FREE_HISTORY_LIMIT (3) casts visible; older entries
 *               are shown as a blurred paywall row with a count badge.
 *   Premium  — unlimited history, delete individual records, clear all.
 *
 * UX:
 *   • useFocusEffect refreshes the list whenever the screen gains focus,
 *     so new casts saved in ResultScreen appear immediately on back-navigation.
 *   • Tap a record → ResultScreen with the reconstructed result (fromHistory=true
 *     so ResultScreen does not attempt to re-save the cast).
 *   • Long-press → delete confirmation Alert.
 *   • "Clear All" in the navbar (premium only) → confirmation Alert.
 *   • Empty state with instructional copy.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  useCallback, useMemo, useRef, useEffect,
} from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Animated,
  StyleSheet, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';

import { useHistory, FREE_HISTORY_LIMIT, reconstructResult } from '../hooks/useHistory';
import { usePremium } from '../hooks/usePremium';
import { useText } from '../context/LanguageContext';
import LanguageToggle from '../components/LanguageToggle';
import { COLORS, FONTS, SPACING } from '../constants/theme';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats a Unix-ms timestamp to a localised date+time string.
 * Uses the active locale so "Jan 15" vs "1月15日" is automatic.
 */
function formatDate(timestamp, isZh) {
  try {
    return new Date(timestamp).toLocaleString(
      isZh ? 'zh-CN' : 'en-US',
      {
        month:  'short', day: 'numeric',
        hour:   '2-digit', minute: '2-digit',
        hour12: !isZh,
      }
    );
  } catch {
    return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');
  }
}

// ─── AuspiciousnessStars ──────────────────────────────────────────────────────

function Stars({ rating = 0, max = 5, size = 10 }) {
  return (
    <View style={styles.starsRow}>
      {Array.from({ length: max }).map((_, i) => (
        <Text key={i} style={[
          styles.star,
          { fontSize: size },
          i < rating && styles.starActive,
        ]}>✦</Text>
      ))}
    </View>
  );
}

// ─── HistoryItem ──────────────────────────────────────────────────────────────

function HistoryItem({ row, onPress, onLongPress, index, isPremium }) {
  const { isZh } = useText();
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  // Staggered entrance animation
  useEffect(() => {
    const delay = Math.min(index * 60, 300); // cap at 300ms total stagger
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1, duration: 320, delay, useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0, tension: 100, friction: 12, delay, useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const result = useMemo(() => reconstructResult(row), [row]);
  if (!result?.originalHexagram?.data) return null;

  const hex  = result.originalHexagram;
  const data = hex.data;
  const name = isZh ? data.name.chinese : data.name.english;
  const auspiciousnessLabel = isZh
    ? data.auspiciousness?.chinese
    : data.auspiciousness?.label;
  const hasChanging = (result.changingLineIndices?.length ?? 0) > 0;

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <TouchableOpacity
        style={styles.item}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={500}
        activeOpacity={0.78}
        accessibilityRole="button"
        accessibilityLabel={`Hexagram ${hex.number}, ${name}. ${auspiciousnessLabel}`}
      >
        {/* ── Left: symbol block ──────────────────────────────────────── */}
        <View style={styles.itemSymbolBlock}>
          <Text style={styles.itemSymbol}>{data.symbol}</Text>
          <Text style={styles.itemHexNum}>卦 {hex.number}</Text>
        </View>

        {/* ── Centre: details ─────────────────────────────────────────── */}
        <View style={styles.itemContent}>
          <Text style={styles.itemName} numberOfLines={1}>{name}</Text>
          <Text style={styles.itemPinyin} numberOfLines={1}>
            {data.name.pinyin}
          </Text>
          {/* Question — shown when set; gracefully absent for old records */}
          {!!row.question && (
            <Text style={styles.itemQuestion} numberOfLines={1}>
              {row.question}
            </Text>
          )}
          <Stars rating={data.auspiciousness?.rating ?? 0} />
          <View style={styles.itemMeta}>
            <Text style={styles.itemDate}>
              {formatDate(row.timestamp, isZh)}
            </Text>
            {hasChanging && (
              <View style={styles.changingBadge}>
                <Text style={styles.changingBadgeText}>
                  {isZh ? '变爻' : 'Changing'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Right: chevron ──────────────────────────────────────────── */}
        <Text style={styles.itemChevron}>›</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── LockedItem (paywall row) ────────────────────────────────────────────────

function LockedItem({ count, onUpgrade, isZh }) {
  return (
    <TouchableOpacity style={styles.lockedItem} onPress={onUpgrade} activeOpacity={0.88}>
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.96)']}
        style={styles.lockedGradient}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
      />
      <View style={styles.lockedContent}>
        <Text style={styles.lockIcon}>✦</Text>
        <Text style={styles.lockedTitle}>
          {isZh ? `另有 ${count} 条占卦记录` : `${count} more divination${count !== 1 ? 's' : ''}`}
        </Text>
        <Text style={styles.lockedSubtitle}>
          {isZh ? '解锁高级版查看完整历史' : 'Unlock Premium to view full history'}
        </Text>
        <View style={styles.lockedCTA}>
          <Text style={styles.lockedCTAText}>
            {isZh ? '立即升级 →' : 'Upgrade →'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState({ isZh }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>☯</Text>
      <Text style={styles.emptyTitle}>
        {isZh ? '尚无占卦记录' : 'No divinations yet'}
      </Text>
      <Text style={styles.emptyBody}>
        {isZh
          ? '完成第一次占卦后，\n您的记录将自动保存于此。'
          : 'Complete your first divination and\nit will be saved here automatically.'}
      </Text>
    </View>
  );
}

// ─── HistoryScreen ────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const navigation           = useNavigation();
  const { t, isZh }         = useText();
  const { isPremium }        = usePremium();
  const {
    records, totalCount, isLoading, error,
    deleteCast, clearAll, refresh,
  } = useHistory();

  // ── Refresh on focus (catches new casts saved in ResultScreen) ────────────
  useFocusEffect(
    useCallback(() => { refresh(); }, [refresh])
  );

  // ── Determine visible vs locked records ───────────────────────────────────
  const visibleRecords = useMemo(() => {
    if (isPremium) return records;
    return records.slice(0, FREE_HISTORY_LIMIT);
  }, [records, isPremium]);

  const lockedCount = isPremium ? 0 : Math.max(0, totalCount - FREE_HISTORY_LIMIT);

  // ── Delete handlers ───────────────────────────────────────────────────────

  const handleDelete = useCallback((row) => {
    const hexResult = reconstructResult(row);
    const name = hexResult?.originalHexagram?.data?.name;
    const displayName = isZh ? name?.chinese : name?.english;

    Alert.alert(
      isZh ? '删除记录' : 'Delete Record',
      isZh
        ? `确定删除"${displayName}"的占卦记录吗？`
        : `Remove the divination for "${displayName}"?`,
      [
        { text: isZh ? '取消' : 'Cancel', style: 'cancel' },
        {
          text:    isZh ? '删除'   : 'Delete',
          style:   'destructive',
          onPress: () => deleteCast(row.session_id),
        },
      ]
    );
  }, [deleteCast, isZh]);

  const handleClearAll = useCallback(() => {
    Alert.alert(
      isZh ? '清空历史' : 'Clear History',
      isZh ? '确定清空全部占卦历史吗？此操作无法撤销。' : 'Remove all divination records? This cannot be undone.',
      [
        { text: isZh ? '取消' : 'Cancel', style: 'cancel' },
        { text: isZh ? '清空' : 'Clear All', style: 'destructive', onPress: clearAll },
      ]
    );
  }, [clearAll, isZh]);

  // ── Navigate to result ────────────────────────────────────────────────────

  const handleRowPress = useCallback((row) => {
    const result = reconstructResult(row);
    if (!result) return;
    navigation.navigate('Result', { result, question: row.question ?? null, fromHistory: true });
  }, [navigation]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item, index }) => (
    <HistoryItem
      key={item.session_id}
      row={item}
      index={index}
      isPremium={isPremium}
      onPress={() => handleRowPress(item)}
      onLongPress={() => isPremium && handleDelete(item)}
    />
  ), [isPremium, handleRowPress, handleDelete]);

  const renderFooter = useCallback(() => {
    if (lockedCount <= 0) return null;
    return (
      <LockedItem
        count={lockedCount}
        isZh={isZh}
        onUpgrade={() => navigation.navigate('Upgrade')}
      />
    );
  }, [lockedCount, isZh, navigation]);

  const ListEmpty = useCallback(() => {
    if (isLoading) return null;
    return <EmptyState isZh={isZh} />;
  }, [isLoading, isZh]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* ── Navbar ─────────────────────────────────────────────────────── */}
      <View style={styles.navbar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navBack}>
          <Text style={styles.navBackText}>← {isZh ? '返回' : 'Back'}</Text>
        </TouchableOpacity>

        <View style={styles.navCenter}>
          <Text style={styles.navTitle}>{isZh ? '历史记录' : 'HISTORY'}</Text>
          {totalCount > 0 && (
            <Text style={styles.navCount}>
              {isPremium
                ? (isZh ? `共 ${totalCount} 次` : `${totalCount} total`)
                : (isZh ? `显示 ${visibleRecords.length}/${totalCount}` : `${visibleRecords.length} of ${totalCount}`)}
            </Text>
          )}
        </View>

        {/* Clear all — premium only */}
        {isPremium && records.length > 0 ? (
          <TouchableOpacity onPress={handleClearAll} style={styles.navAction}>
            <Text style={styles.navActionText}>{isZh ? '清空' : 'Clear'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.navActionPlaceholder} />
        )}
      </View>

      {/* ── Language toggle strip ───────────────────────────────────────── */}
      <View style={styles.toggleStrip}>
        <LanguageToggle size="sm" />
      </View>

      {/* ── Loading state ───────────────────────────────────────────────── */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={COLORS.gold} size="small" />
        </View>
      )}

      {/* ── Error state ─────────────────────────────────────────────────── */}
      {!!error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>
            {isZh ? '无法加载历史记录' : 'Could not load history'}: {error}
          </Text>
        </View>
      )}

      {/* ── Long-press hint (free users, premium hint) ─────────────────── */}
      {isPremium && records.length > 0 && (
        <Text style={styles.hintText}>
          {isZh ? '长按可删除单条记录' : 'Long-press a record to delete it'}
        </Text>
      )}

      {/* ── List ───────────────────────────────────────────────────────── */}
      <FlatList
        data={visibleRecords}
        keyExtractor={item => item.session_id}
        renderItem={renderItem}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={[
          styles.listContent,
          visibleRecords.length === 0 && styles.listContentEmpty,
        ]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* ── Disclaimer ─────────────────────────────────────────────────── */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {isZh
            ? '仅供娱乐与反思之用，不构成专业建议。'
            : 'For entertainment and reflection only.'}
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  // ── Navbar
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop:        Platform.OS === 'ios' ? 56 : 36,
    paddingBottom:     12,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.goldDim,
    backgroundColor:   COLORS.background,
  },
  navBack:     { padding: 4, minWidth: 60 },
  navBackText: { fontFamily: FONTS.caption, fontSize: 13, color: COLORS.gold, letterSpacing: 0.5 },

  navCenter: { flex: 1, alignItems: 'center' },
  navTitle:  { fontFamily: FONTS.caption, fontSize: 11, color: COLORS.goldMuted, letterSpacing: 4 },
  navCount:  { fontFamily: FONTS.caption, fontSize: 9,  color: COLORS.textSecondary, letterSpacing: 1, marginTop: 2 },

  navAction:            { minWidth: 60, alignItems: 'flex-end', padding: 4 },
  navActionPlaceholder: { minWidth: 60 },
  navActionText:        { fontFamily: FONTS.caption, fontSize: 12, color: COLORS.changing, letterSpacing: 0.5 },

  // ── Toggle strip
  toggleStrip: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.goldDim + '55',
  },

  // ── Loading / error
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBanner: {
    margin: SPACING.md, padding: SPACING.sm,
    backgroundColor: 'rgba(207,102,121,0.1)',
    borderRadius: 8, borderWidth: 1, borderColor: COLORS.error + '44',
  },
  errorText: { fontFamily: FONTS.body, fontSize: 12, color: COLORS.error, textAlign: 'center' },

  // ── Hint
  hintText: {
    fontFamily: FONTS.caption, fontSize: 9, color: COLORS.textDim,
    textAlign: 'center', letterSpacing: 1,
    paddingVertical: SPACING.xs, opacity: 0.6,
  },

  // ── List
  listContent:      { paddingHorizontal: SPACING.lg, paddingBottom: 80 },
  listContentEmpty: { flex: 1 },
  separator:        { height: 1, backgroundColor: COLORS.goldDim + '33', marginHorizontal: SPACING.sm },

  // ── Item
  item: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
  },

  itemSymbolBlock: { alignItems: 'center', width: 52, marginRight: SPACING.md },
  itemSymbol:      { fontSize: 26, color: COLORS.gold, lineHeight: 32 },
  itemHexNum:      { fontFamily: FONTS.caption, fontSize: 8, color: COLORS.goldDim, letterSpacing: 1, marginTop: 2 },

  itemContent: { flex: 1 },
  itemName:    { fontFamily: FONTS.display, fontSize: 18, color: COLORS.text, letterSpacing: 2, marginBottom: 2 },
  itemPinyin:  { fontFamily: FONTS.bodyItalic, fontSize: 11, color: COLORS.textSecondary, marginBottom: 4 },

  // User's focus question — truncated to one line, visually quieter than the name
  itemQuestion: {
    fontFamily:  FONTS.body,
    fontSize:    12,
    color:       COLORS.goldMuted,
    letterSpacing: 0.2,
    marginBottom: SPACING.xs,
    fontStyle:   'italic',
  },

  starsRow: { flexDirection: 'row', marginBottom: 4 },
  star:      { color: COLORS.surfaceDim, marginRight: 1.5 },
  starActive:{ color: COLORS.gold },

  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  itemDate: { fontFamily: FONTS.caption, fontSize: 10, color: COLORS.textSecondary, letterSpacing: 0.3 },

  changingBadge: {
    backgroundColor: COLORS.changing + '22', borderRadius: 4,
    borderWidth: 1, borderColor: COLORS.changing + '55',
    paddingHorizontal: 5, paddingVertical: 1,
  },
  changingBadgeText: { fontFamily: FONTS.caption, fontSize: 8, color: COLORS.changing, letterSpacing: 0.5 },

  itemChevron: { color: COLORS.goldDim, fontSize: 22, marginLeft: SPACING.sm },

  // ── Locked paywall row
  lockedItem: {
    marginTop: SPACING.md, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.gold + '44',
    overflow: 'hidden', minHeight: 140,
    backgroundColor: COLORS.surface,
  },
  lockedGradient: { ...StyleSheet.absoluteFillObject, zIndex: 0 },
  lockedContent: {
    zIndex: 1, alignItems: 'center',
    paddingVertical: SPACING.xl, paddingHorizontal: SPACING.lg,
  },
  lockIcon:       { fontSize: 24, color: COLORS.gold, marginBottom: SPACING.sm },
  lockedTitle:    { fontFamily: FONTS.display, fontSize: 16, color: COLORS.gold, letterSpacing: 2, marginBottom: SPACING.xs, textAlign: 'center' },
  lockedSubtitle: { fontFamily: FONTS.body, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: SPACING.md },
  lockedCTA:      { backgroundColor: COLORS.gold, borderRadius: 8, paddingVertical: 8, paddingHorizontal: SPACING.lg },
  lockedCTAText:  { fontFamily: FONTS.caption, fontSize: 12, color: '#000', letterSpacing: 1.5, fontWeight: '700' },

  // ── Empty state
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl, paddingTop: SPACING.xxl },
  emptyIcon:  { fontSize: 48, color: COLORS.goldDim, marginBottom: SPACING.lg, opacity: 0.5 },
  emptyTitle: { fontFamily: FONTS.display, fontSize: 20, color: COLORS.goldMuted, letterSpacing: 4, marginBottom: SPACING.md, textAlign: 'center' },
  emptyBody:  { fontFamily: FONTS.body, fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },

  // ── Footer
  footer: { paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.goldDim + '22', alignItems: 'center' },
  footerText: { fontFamily: FONTS.caption, fontSize: 9, color: COLORS.textSecondary, letterSpacing: 0.5, opacity: 0.45 },
});
