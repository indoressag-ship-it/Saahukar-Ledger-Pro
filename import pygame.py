import pygame
pygame .init()

SCREEN_WIDTH = 500
SCREEN_HEIGHT = 500

window  = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption("My Game")
white= (255, 255, 255)

def main():
    while True:
        #to draw a rectangle 
        #(window, color, (x,y, width, height))
        #the rectangle cannot be seen
        