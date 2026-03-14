import React, { PropsWithChildren, useCallback, useMemo, useRef } from 'react'
import {
  LayoutChangeEvent,
  StyleProp,
  View,
  type ViewStyle,
} from 'react-native'
import {
  ComposedGesture,
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  GestureStateChangeEvent,
  GestureTouchEvent,
  GestureUpdateEvent,
  PanGestureHandlerEventPayload,
  PinchGestureHandlerEventPayload,
  State,
} from 'react-native-gesture-handler'
import { GestureStateManagerType } from 'react-native-gesture-handler/lib/typescript/handlers/gestures/gestureStateManager'
import Animated, {
  AnimatableValue,
  AnimationCallback,
  runOnJS,
  SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated'
import { MAX_SCALE, MIN_SCALE } from './constants'
import { clampScale, getScaleFromDimensions } from './utils'
import styles from './styles'

export type AnimationConfigProps = Parameters<typeof withTiming>[1];

interface UseZoomGestureProps {
  animationFunction?: typeof withTiming;
  animationConfig?: AnimationConfigProps;
  doubleTapConfig?: {
    defaultScale?: number;
    minZoomScale?: number;
    maxZoomScale?: number;
  };
}

export function useZoomGesture(props: UseZoomGestureProps = {}): {
  zoomGesture: ComposedGesture;
  contentContainerAnimatedStyle: any;
  onLayout(event: LayoutChangeEvent): void;
  onLayoutContent(event: LayoutChangeEvent): void;
  zoomOut(): void;
  isZoomedIn: SharedValue<boolean>;
  zoomGestureLastTime: SharedValue<number>;
} {
  const {
    animationFunction = withTiming,
    animationConfig,
    doubleTapConfig,
  } = props

  const baseScale = useSharedValue(1)
  const pinchScale = useSharedValue(1)
  const lastScale = useSharedValue(1)
  const isZoomedIn = useSharedValue(false)
  const zoomGestureLastTime = useSharedValue(0)
  const containerDimensions = useSharedValue({ width: 0, height: 0 })
  const contentDimensions = useSharedValue({ width: 1, height: 1 })
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const lastOffsetX = useSharedValue(0)
  const lastOffsetY = useSharedValue(0)
  const panStartOffsetX = useSharedValue(0)
  const panStartOffsetY = useSharedValue(0)
  const velocity = useSharedValue({ x: 0, y: 0 })

  const focalOffsetX = useSharedValue(0)
  const focalOffsetY = useSharedValue(0)
  const pinchOriginX = useSharedValue(0)
  const pinchOriginY = useSharedValue(0)

  const handlePanOutsideTimeoutId = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const withAnimation = useCallback(
    (toValue: number, config?: AnimationConfigProps) => {
      'worklet'
      return animationFunction(toValue, {
        duration: 350,
        ...config,
        ...animationConfig,
      })
    },
    [animationFunction, animationConfig]
  )

  const getContentContainerSize = useCallback(() => {
    return {
      width: containerDimensions.value.width,
      height:
        (contentDimensions.value.height * containerDimensions.value.width) /
        contentDimensions.value.width,
    }
  }, [containerDimensions, contentDimensions])

  const zoomIn = useCallback((focalX?: number, focalY?: number): void => {
    const { width, height } = getContentContainerSize()
    const newScale =
      doubleTapConfig?.defaultScale ?? getScaleFromDimensions(width, height)
    const clampedScale = clampScale(
      newScale,
      doubleTapConfig?.minZoomScale ?? MIN_SCALE,
      doubleTapConfig?.maxZoomScale ?? MAX_SCALE
    )
    lastScale.value = clampedScale
    baseScale.value = withAnimation(newScale)
    pinchScale.value = withAnimation(1)

    const newOffsetX = focalX !== undefined
      ? (containerDimensions.value.width / 2 - focalX) / newScale
      : 0
    const newOffsetY = focalY !== undefined
      ? (containerDimensions.value.height / 2 - focalY) / newScale
      : 0

    lastOffsetX.value = newOffsetX
    lastOffsetY.value = newOffsetY
    translateX.value = withAnimation(newOffsetX)
    translateY.value = withAnimation(newOffsetY)
    
    focalOffsetX.value = 0
    focalOffsetY.value = 0

    isZoomedIn.value = true
  }, [
    baseScale,
    pinchScale,
    lastOffsetX,
    lastOffsetY,
    translateX,
    translateY,
    isZoomedIn,
    lastScale,
    containerDimensions,
    getContentContainerSize,
    withAnimation,
    doubleTapConfig,
    focalOffsetX,
    focalOffsetY,
  ])

  const zoomOut = useCallback((): void => {
    const newScale = 1
    lastScale.value = newScale
    baseScale.value = withAnimation(newScale)
    pinchScale.value = withAnimation(1)
    const newOffsetX = 0
    lastOffsetX.value = newOffsetX
    const newOffsetY = 0
    lastOffsetY.value = newOffsetY
    translateX.value = withAnimation(newOffsetX)
    translateY.value = withAnimation(newOffsetY)
    
    focalOffsetX.value = 0
    focalOffsetY.value = 0

    isZoomedIn.value = false
  }, [
    baseScale,
    pinchScale,
    lastOffsetX,
    lastOffsetY,
    translateX,
    translateY,
    lastScale,
    isZoomedIn,
    withAnimation,
    focalOffsetX,
    focalOffsetY,
  ])

  const handlePanOutside = useCallback((): void => {
    if (handlePanOutsideTimeoutId.current !== undefined)
      clearTimeout(handlePanOutsideTimeoutId.current)
    handlePanOutsideTimeoutId.current = setTimeout((): void => {
      const { width } = getContentContainerSize()
      const maxOffset = {
        x:
          width * lastScale.value < containerDimensions.value.width
            ? 0
            : (width * lastScale.value - containerDimensions.value.width) /
              2 /
              lastScale.value,
      }
      
      translateX.value = withDecay({
        velocity: velocity.value.x,
        clamp: [-maxOffset.x, maxOffset.x],
        rubberBandEffect: true,
      })
      lastOffsetX.value = withDecay({
        velocity: velocity.value.x,
        clamp: [-maxOffset.x, maxOffset.x],
        rubberBandEffect: true,
      })
    }, 10)
  }, [
    lastOffsetX,
    lastScale,
    translateX,
    containerDimensions,
    getContentContainerSize,
  ])

  const onDoubleTap = useCallback((focalX: number, focalY: number): void => {
    if (isZoomedIn.value) zoomOut()
    else zoomIn(focalX, focalY)
  }, [zoomIn, zoomOut, isZoomedIn])

  const onLayout = useCallback(
    ({
      nativeEvent: {
        layout: { width, height },
      },
    }: LayoutChangeEvent): void => {
      containerDimensions.value = {
        width,
        height,
      }
    },
    [containerDimensions]
  )

  const onLayoutContent = useCallback(
    ({
      nativeEvent: {
        layout: { width, height },
      },
    }: LayoutChangeEvent): void => {
      contentDimensions.value = {
        width,
        height,
      }
    },
    [contentDimensions]
  )

  const onPinchEnd = useCallback(
    (scale: number): void => {
      const newScale = lastScale.value * scale
      lastScale.value = newScale
      if (newScale > 1) {
        isZoomedIn.value = true
        baseScale.value = newScale
        pinchScale.value = 1
        handlePanOutside()
      } else {
        zoomOut()
      }
    },
    [lastScale, baseScale, pinchScale, handlePanOutside, zoomOut, isZoomedIn]
  )

  const updateZoomGestureLastTime = useCallback((): void => {
    'worklet'
    zoomGestureLastTime.value = Date.now()
  }, [zoomGestureLastTime])

  const zoomGesture = useMemo(() => {
    const tapGesture = Gesture.Tap()
      .numberOfTaps(2)
      .onStart(() => {
        updateZoomGestureLastTime()
      })
      .onEnd((event) => {
        updateZoomGestureLastTime()
        runOnJS(onDoubleTap)(event.x, event.y)
      })
      .maxDeltaX(25)
      .maxDeltaY(25)

    const panGesture = Gesture.Pan()
      .activeOffsetX([-20, 20])
      .onTouchesMove(
        (e: GestureTouchEvent, state: GestureStateManagerType): void => {
          // Si el usuario pone 2 dedos, forzamos la activación del gesto para
          // bloquear al FlatList y permitir que el Pinch funcione perfecto.
          if (([State.UNDETERMINED, State.BEGAN] as State[]).includes(e.state)) {
            if (e.numberOfTouches >= 2) {
              state.activate()
            }
          }
        }
      )
      .onStart(
        (event: GestureUpdateEvent<PanGestureHandlerEventPayload>): void => {
          updateZoomGestureLastTime()
          panStartOffsetX.value = event.translationX
        }
      )
      .onUpdate(
        (event: GestureUpdateEvent<PanGestureHandlerEventPayload>): void => {
          updateZoomGestureLastTime()
          let { translationX } = event
          translationX -= panStartOffsetX.value

          translateX.value =
            lastOffsetX.value +
            translationX / lastScale.value / pinchScale.value
        }
      )
      .onEnd(
        (
          event: GestureStateChangeEvent<PanGestureHandlerEventPayload>
        ): void => {
          updateZoomGestureLastTime()
          let { translationX } = event
          translationX -= panStartOffsetX.value
          
          const currentScale = lastScale.value * pinchScale.value

          velocity.value = {
            x: event.velocityX / currentScale,
            y: 0,
          }
          
          lastOffsetX.value =
            lastOffsetX.value + translationX / currentScale
            
          runOnJS(handlePanOutside)()
        }
      )

    const pinchGesture = Gesture.Pinch()
      .onStart((event) => {
        updateZoomGestureLastTime()
        pinchOriginX.value = event.focalX - containerDimensions.value.width / 2
        pinchOriginY.value = event.focalY - containerDimensions.value.height / 2
        focalOffsetX.value = 0
        focalOffsetY.value = 0
      })
      .onUpdate(
        (event: GestureUpdateEvent<PinchGestureHandlerEventPayload>): void => {
          updateZoomGestureLastTime()
          const clamped = Math.max(1, event.scale)
          pinchScale.value = clamped

          const currentTotalScale = lastScale.value * clamped
          const startTotalScale = lastScale.value

          focalOffsetX.value =
            pinchOriginX.value * (1 / currentTotalScale - 1 / startTotalScale)
          focalOffsetY.value =
            pinchOriginY.value * (1 / currentTotalScale - 1 / startTotalScale)
        }
      )
      .onEnd(
        (event: GestureUpdateEvent<PinchGestureHandlerEventPayload>): void => {
          updateZoomGestureLastTime()
          const clamped = Math.max(1, event.scale)
          pinchScale.value = clamped

          lastOffsetX.value += focalOffsetX.value
          lastOffsetY.value += focalOffsetY.value

          translateX.value += focalOffsetX.value
          translateY.value += focalOffsetY.value

          focalOffsetX.value = 0
          focalOffsetY.value = 0

          runOnJS(onPinchEnd)(event.scale)
        }
      )
      .onFinalize(() => {})

    return Gesture.Simultaneous(tapGesture, panGesture, pinchGesture)
  }, [
    handlePanOutside,
    lastOffsetX,
    lastOffsetY,
    onDoubleTap,
    onPinchEnd,
    pinchScale,
    translateX,
    translateY,
    lastScale,
    isZoomedIn,
    panStartOffsetX,
    panStartOffsetY,
    updateZoomGestureLastTime,
    containerDimensions,
    focalOffsetX,
    focalOffsetY,
    pinchOriginX,
    pinchOriginY,
  ])

  const contentContainerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: baseScale.value * pinchScale.value },
      { translateX: translateX.value + focalOffsetX.value },
      { translateY: translateY.value + focalOffsetY.value },
    ],
  }))

  return {
    zoomGesture,
    contentContainerAnimatedStyle,
    onLayout,
    onLayoutContent,
    zoomOut,
    isZoomedIn,
    zoomGestureLastTime,
  }
}

export default function Zoom(
  props: PropsWithChildren<ZoomProps>
): React.JSX.Element {
  const { style, contentContainerStyle, children, onZoomStateChange, ...rest } = props
  const {
    zoomGesture,
    onLayout,
    onLayoutContent,
    contentContainerAnimatedStyle,
    isZoomedIn,
  } = useZoomGesture({
    ...rest,
  })

  useAnimatedReaction(
    () => isZoomedIn.value,
    (current, previous) => {
      if (current !== previous && onZoomStateChange) {
        runOnJS(onZoomStateChange)(current)
      }
    }
  )

  return (
    <GestureHandlerRootView>
      <GestureDetector gesture={zoomGesture}>
        <View
         style={[styles.container, style]}
         onLayout={onLayout}
         pointerEvents="box-none"
         collapsable={false}
        >
          <Animated.View
            pointerEvents="box-none"
            style={[contentContainerAnimatedStyle, contentContainerStyle]}
            onLayout={onLayoutContent}
          >
            {children}
          </Animated.View>
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  )
}

export interface ZoomProps {
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  animationConfig?: AnimationConfigProps;
  onZoomStateChange?: (isZoomedIn: boolean) => void;
  doubleTapConfig?: {
    defaultScale?: number;
    minZoomScale?: number;
    maxZoomScale?: number;
  };
  animationFunction?<T extends AnimatableValue>(
    toValue: T,
    userConfig?: AnimationConfigProps,
    callback?: AnimationCallback,
  ): T;
}