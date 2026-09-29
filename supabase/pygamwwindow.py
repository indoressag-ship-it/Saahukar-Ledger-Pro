import pygame
pygame. init()

SCREEN_WITDTH = 500
SCREEN_HEIGHT =500

window = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption("My First Game")
white=(255,255,255
       
def main():
    while True:
    pygame.draw.rect(window,(255,255,0),(100,100,50,50))
    window.fill(white)
    pygame.display.flip()

if __name__== "__main__":
     main()

     



        